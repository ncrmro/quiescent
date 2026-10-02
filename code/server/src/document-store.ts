import type { CommitSignature, PublishingForge } from "@quiescent/git";
import {
  type DocumentInput,
  documentCodec,
  type Frontmatter,
  type JSONSchema,
} from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";
import { type DocumentAssets, documentLayout } from "./document-layout.ts";
import { draftBranches } from "./document-naming.ts";

export type { DocumentInput, Frontmatter, JSONSchema } from "./document-codec.ts";
export { DocumentError } from "./document-error.ts";

import type {
  DocumentDraft,
  DocumentRecord,
  DocumentSelection,
  StoredDocument,
} from "./contracts.ts";

export type {
  DocumentDraft,
  DocumentRecord,
  DocumentSelection,
  StoredDocument,
} from "./contracts.ts";
export interface DocumentStoreOptions<T extends Frontmatter> {
  forge: PublishingForge;
  author: CommitSignature;
  collection: string;
  schema: JSONSchema;
  defaultBranch?: string;
  directory?: string;
  draftBranch?: string;
  filename?: (document: DocumentRecord<T>) => string;
  assets?: DocumentAssets<T>;
  beforePublish?: (document: DocumentRecord<T>) => void | Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validUuid(id: unknown): id is string {
  return typeof id === "string" && uuid.test(id);
}
function publishedRecord<T extends Frontmatter>(document: StoredDocument<T> | null) {
  return document?.publishedAt ? publicDocument(document) : null;
}
function publicDocument<T extends Frontmatter>(document: StoredDocument<T>): DocumentRecord<T> {
  const { publicationSource: _, deletedAt: __, ...value } = document;
  return value;
}
/** Schema-validated Markdown documents; Git is the authority for every lifecycle operation. */
export function createDocumentStore<T extends Frontmatter = Frontmatter>(
  options: DocumentStoreOptions<T>,
) {
  const { forge, author } = options;
  const main = options.defaultBranch ?? "main";
  const collection = options.collection;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(collection))
    throw new DocumentError("Invalid collection name", "invalid");
  const codec = documentCodec<T>(options.schema);
  const branches = draftBranches(collection, options.draftBranch);
  const layout = documentLayout(options);
  const path = layout.checkId;
  const read = layout.read;
  function checkBranch(id: string, branch: string) {
    path(id);
    if (branches.id(branch) !== id) throw new DocumentError("Invalid draft", "invalid");
  }
  function checked(input: DocumentInput<T>): DocumentInput<T> {
    const value = codec.validate(input);
    if ("id" in value.frontmatter || "createdAt" in value.frontmatter)
      throw new DocumentError("id and createdAt are managed document fields", "invalid");
    return value;
  }
  async function commit(
    branch: string,
    expectedHeadSha: string,
    document: StoredDocument<T>,
    message: string,
  ) {
    const files = await layout.changes(document, expectedHeadSha);
    return forge.commitFiles({ branch, expectedHeadSha, author, message, files });
  }
  async function getPublished(id: string): Promise<DocumentDraft<T> | null> {
    const headSha = await forge.getBranchSha(main);
    const document = await read(id, headSha);
    return document?.publishedAt && !document.deletedAt
      ? { document: publicDocument(document), branch: null, headSha, state: "published" }
      : null;
  }
  async function listPublished(): Promise<DocumentDraft<T>[]> {
    const headSha = await forge.getBranchSha(main);
    const ids = await layout.ids(headSha);
    const documents = (await layout.readMany(ids.map((id) => ({ id, ref: headSha })))).map(
      (document) =>
        document?.publishedAt && !document.deletedAt
          ? {
              document: publicDocument(document),
              branch: null,
              headSha,
              state: "published" as const,
            }
          : null,
    );
    return documents.filter(
      (p): p is DocumentDraft<T> & { state: "published"; branch: null } => p !== null,
    );
  }
  async function loadActiveDraft(name: string, sha: string, mainSha: string) {
    const documentId = branches.id(name);
    if (!documentId) return null;
    try {
      checkBranch(documentId, name);
    } catch {
      return null;
    }
    if (await forge.isAncestor(sha, mainSha)) return null;
    if ((await read(documentId, mainSha))?.deletedAt) return null;
    const document = await read(documentId, sha);
    return document
      ? {
          document: publicDocument(document),
          branch: name,
          headSha: sha,
          state: document.publishedAt ? ("unpublished-changes" as const) : ("draft" as const),
        }
      : null;
  }
  async function activeDrafts(id?: string): Promise<DocumentDraft<T>[]> {
    const mainSha = await forge.getBranchSha(main);
    const candidates = (await forge.listBranches(branches.listPrefix(id))).filter((branch) => {
      const documentId = branches.id(branch.name);
      return documentId && (!id || documentId === id);
    });
    const result: DocumentDraft<T>[] = [];
    // Limit GitHub concurrency while avoiding one network waterfall per historical branch.
    for (let offset = 0; offset < candidates.length; offset += 6) {
      const batch = await Promise.all(
        candidates
          .slice(offset, offset + 6)
          .map(({ name, sha }) => loadActiveDraft(name, sha, mainSha)),
      );
      for (const document of batch) if (document) result.push(document);
    }
    return result;
  }

  async function start(
    document: DocumentRecord<T>,
    cycle: string = crypto.randomUUID(),
  ): Promise<DocumentDraft<T>> {
    const sha = await forge.getBranchSha(main);
    const branch = branches.name(document.id, cycle);
    const files = await layout.changes(document, sha);
    await forge.createBranch(branch, sha);
    const result = await forge.commitFiles({
      branch,
      expectedHeadSha: sha,
      author,
      files,
      message: "Save document draft",
    });
    return {
      document: document,
      branch,
      headSha: result.sha,
      state: document.publishedAt ? "unpublished-changes" : "draft",
    };
  }
  async function ensureBranch(branch: string, base: string) {
    try {
      await forge.createBranch(branch, base);
    } catch (error) {
      // Also covers a successful create whose response was lost. Never reset a ref.
      try {
        await forge.getBranchSha(branch);
      } catch {
        throw error;
      }
    }
  }
  async function startPublished(published: DocumentDraft<T>): Promise<DocumentDraft<T>> {
    // One deterministic branch per published document revision, independent of unrelated
    // main-branch commits. GitHub's create-ref and commit CAS arbitrate concurrent tabs.
    const file = await read(published.document.id, published.headSha);
    if (!file) throw new DocumentError("Document not found", "not_found");
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(publicDocument(file))),
        ),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const cycle = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    const branch = branches.name(published.document.id, cycle);
    await ensureBranch(branch, published.headSha);
    const head = await forge.getBranchSha(branch);
    const current = await read(published.document.id, head);
    if (current && JSON.stringify(current) === JSON.stringify(file)) {
      try {
        await commit(branch, head, published.document, "Save document draft");
      } catch (error) {
        // A racing initializer or writer won. Load its version instead of overwriting it.
        if ((await forge.getBranchSha(branch)) === head) throw error;
      }
    } else if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      // This exact cycle finished while the caller was opening it; resolve the new cycle.
      return getDraft(published.document.id);
    }
    return getDraft(published.document.id, branch);
  }
  async function createDocument(
    input: DocumentInput<T> & { id?: string },
  ): Promise<DocumentDraft<T>> {
    const value = checked(input);
    const id = input.id ?? crypto.randomUUID();
    if (!validUuid(id)) throw new DocumentError("Invalid document UUID", "invalid");
    if (input.id) {
      if (await read(id, await forge.getBranchSha(main)))
        throw new DocumentError("Document already exists", "conflict");
      const existing = (await activeDrafts(id))[0];
      if (existing) {
        if (JSON.stringify(checked(existing.document)) !== JSON.stringify(value))
          throw new DocumentError("Document already exists with different content", "conflict");
        return existing;
      }
    }
    return start({ ...value, id, createdAt: new Date().toISOString().slice(0, 10) }, id);
  }
  async function assertNotDeleted(id: string, mainSha?: string) {
    if ((await read(id, mainSha ?? (await forge.getBranchSha(main))))?.deletedAt)
      throw new DocumentError(
        "This document was deleted. Your local writing has been preserved.",
        "not_found",
      );
  }
  async function getDraft(id: string, branch?: string): Promise<DocumentDraft<T>> {
    path(id);
    await assertNotDeleted(id);
    if (branch) {
      checkBranch(id, branch);
      const headSha = await forge.getBranchSha(branch);
      const document = await read(id, headSha);
      if (!document) throw new DocumentError("Draft not found", "not_found");
      return {
        document: publicDocument(document),
        branch,
        headSha,
        state: document.publishedAt ? "unpublished-changes" : "draft",
      };
    }
    const drafts = await activeDrafts(id);
    if (drafts[0]) return drafts[0];
    const published = await getPublished(id);
    if (!published) throw new DocumentError("Document not found", "not_found");
    return startPublished(published);
  }
  async function saveDraft(
    input: DocumentSelection & { document: DocumentInput<T> & { id?: string } },
  ): Promise<DocumentDraft<T>> {
    checkBranch(input.id, input.branch);
    await assertNotDeleted(input.id);
    if (!input.document) throw new DocumentError("Document missing", "invalid");
    if (input.document.id !== undefined && input.id !== input.document.id)
      throw new DocumentError("Document identifier mismatch", "invalid");
    const head = await forge.getBranchSha(input.branch);
    if (head !== input.expectedHeadSha)
      throw new DocumentError(
        "This draft has newer changes. Your writing has been preserved.",
        "conflict",
      );
    const previous = await read(input.id, head);
    if (!previous) throw new DocumentError("Draft not found", "not_found");
    if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      throw new DocumentError(
        "This draft was published. Reopen the document to continue editing.",
        "conflict",
      );
    }
    const document = {
      ...checked(input.document),
      id: input.id,
      createdAt: previous.createdAt,
      ...(previous.publishedAt ? { publishedAt: previous.publishedAt } : {}),
    };
    const result = await commit(input.branch, head, document, "Save document draft");
    return {
      document: document,
      branch: input.branch,
      headSha: result.sha,
      state: document.publishedAt ? "unpublished-changes" : "draft",
    };
  }
  async function wasPublished(
    input: DocumentSelection,
    published: StoredDocument<T>,
    mainSha: string,
  ) {
    if (published.publicationSource === input.expectedHeadSha) return true;
    if (!published.publicationSource || !(await forge.isAncestor(input.expectedHeadSha, mainSha)))
      return false;
    return (
      (await read(input.id, input.expectedHeadSha))?.publicationSource ===
      published.publicationSource
    );
  }
  async function publish(input: DocumentSelection) {
    checkBranch(input.id, input.branch);
    await assertNotDeleted(input.id);
    let head = await forge.getBranchSha(input.branch);
    let document = await read(input.id, head);
    if (!document) throw new DocumentError("Draft not found", "not_found");
    const mainSha = await forge.getBranchSha(main);
    // A repeated request after a lost response must not re-publish or modify newer edits.
    const published = await read(input.id, mainSha);
    if (published && (await wasPublished(input, published, mainSha))) {
      return {
        document: publicDocument(published),
        previous: publicDocument(published),
        headSha: head,
        publishedSha: mainSha,
        state: "published" as const,
      };
    }
    if (head !== input.expectedHeadSha && document.publicationSource !== input.expectedHeadSha) {
      throw new DocumentError(
        "This draft has newer changes. Review them before publishing.",
        "conflict",
      );
    }
    await layout.assertScope(input.id, mainSha, head);
    await layout.assertDestination(document, mainSha);
    await checked(document);
    await options.beforePublish?.(publicDocument(document));
    if (!document.publicationSource) {
      document = {
        ...document,
        publishedAt: document.publishedAt ?? new Date().toISOString(),
        publicationSource: input.expectedHeadSha,
      };
      head = (await commit(input.branch, head, document, "Prepare document publication")).sha;
    }
    const publicationSource = document.publicationSource;
    const result = await forge.mergeBranch(main, head);
    const visible = await read(input.id, result.sha);
    if (!visible || visible.publicationSource !== publicationSource)
      throw new DocumentError("Publication could not be confirmed. Retry safely.", "conflict");
    return {
      document: publicDocument(visible),
      previous: publishedRecord(published),
      headSha: head,
      publishedSha: result.sha,
      state: "published" as const,
    };
  }
  async function deleteDocument(input: {
    id: string;
    branch?: string | null;
    expectedHeadSha: string;
  }) {
    path(input.id);
    const mainSha = await forge.getBranchSha(main);
    const current = await read(input.id, mainSha);
    if (current?.deletedAt)
      return {
        id: input.id,
        document: publicDocument(current),
        previous: publicDocument(current),
        headSha: mainSha,
        deleted: true as const,
      };
    const previous = await read(input.id, input.expectedHeadSha);
    if (!previous) throw new DocumentError("Document not found", "not_found");
    if (input.branch) {
      checkBranch(input.id, input.branch);
      if ((await forge.getBranchSha(input.branch)) !== input.expectedHeadSha)
        throw new DocumentError(
          "This draft has newer changes. Reopen it before deleting.",
          "conflict",
        );
      // A concurrently published revision must not be removed by a stale draft tab.
      if (
        current?.publicationSource &&
        !(await forge.isAncestor(current.publicationSource, input.expectedHeadSha)) &&
        current.publicationSource !== input.expectedHeadSha
      )
        throw new DocumentError(
          "This document was published since you opened it. Reopen it before deleting.",
          "conflict",
        );
    } else if (JSON.stringify(current) !== JSON.stringify(previous)) {
      throw new DocumentError(
        "This document has newer changes. Reopen it before deleting.",
        "conflict",
      );
    }
    // The tombstone is authoritative across all retained branches and survives restarts.
    const result = await commit(
      main,
      mainSha,
      { ...previous, body: "", deletedAt: new Date().toISOString() },
      "Delete document",
    );
    return {
      id: input.id,
      document: publicDocument(previous),
      previous: publishedRecord(current),
      headSha: result.sha,
      deleted: true as const,
    };
  }
  /** Select an existing live draft only. Unlike getDraft this never starts an editing cycle. */
  async function readDraft(id: string, branch?: string): Promise<DocumentDraft<T> | null> {
    path(id);
    if (!branch) return (await activeDrafts(id))[0] ?? null;
    checkBranch(id, branch);
    const mainSha = await forge.getBranchSha(main);
    let headSha: string;
    try {
      headSha = await forge.getBranchSha(branch);
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404)
        return null;
      throw error;
    }
    return loadActiveDraft(branch, headSha, mainSha);
  }
  async function listDocuments(): Promise<DocumentDraft<T>[]> {
    const [mainSha, branchesAtHead] = await Promise.all([
      forge.getBranchSha(main),
      forge.listBranches(branches.listPrefix()),
    ]);
    const candidates: Array<{ name: string; sha: string }> = [];
    const valid = branchesAtHead.filter(({ name }) => branches.id(name));
    // Retained merged branches may have an obsolete schema: filter before decoding them.
    for (let offset = 0; offset < valid.length; offset += 6) {
      const batch = valid.slice(offset, offset + 6);
      const merged = await Promise.all(batch.map(({ sha }) => forge.isAncestor(sha, mainSha)));
      candidates.push(...batch.filter((_, i) => !merged[i]));
    }
    const mainIds = await layout.ids(mainSha);
    const ids = [...new Set([...mainIds, ...candidates.map(({ name }) => branches.id(name)!)])];
    const records = await layout.readMany(
      [
        ...ids.map((id) => ({ id, ref: mainSha })),
        ...candidates.map(({ name, sha }) => ({ id: branches.id(name)!, ref: sha })),
      ],
      mainSha,
    );
    const mainRecords = new Map(ids.map((id, i) => [id, records[i]]));
    const drafts: DocumentDraft<T>[] = candidates.flatMap(({ name, sha }, i) => {
      const document = records[ids.length + i];
      return document && !document.deletedAt
        ? [
            {
              document: publicDocument(document),
              branch: name,
              headSha: sha,
              state: document.publishedAt ? ("unpublished-changes" as const) : ("draft" as const),
            },
          ]
        : [];
    });
    const draftIds = new Set(drafts.map((draft) => draft.document.id));
    const published = ids.flatMap((id) => {
      const document = mainRecords.get(id);
      return document?.publishedAt && !document.deletedAt && !draftIds.has(id)
        ? [
            {
              document: publicDocument(document),
              branch: null,
              headSha: mainSha,
              state: "published" as const,
            },
          ]
        : [];
    });
    return [...drafts, ...published];
  }
  return {
    collection,
    location: layout.location,
    schema: options.schema,
    createDocument,
    getDraft,
    readDraft,
    saveDraft,
    publish,
    deleteDocument,
    getPublished,
    listPublished,
    listDocuments,
  };
}
