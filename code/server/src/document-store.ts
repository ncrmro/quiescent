import type { CommitSignature, PublishingForge, CommitFileChange } from "@quiescent/git";
import { documentCodec, type DocumentInput, type Frontmatter, type JSONSchema } from './document-codec.ts';
import { DocumentError } from './document-error.ts';
export type { DocumentInput, Frontmatter, JSONSchema } from './document-codec.ts';
export { DocumentError } from './document-error.ts';
export interface DocumentRecord<T extends Frontmatter = Frontmatter> extends DocumentInput<T> {
  id: string;
  publishedAt?: string;
}
export interface StoredDocument<T extends Frontmatter = Frontmatter> extends DocumentRecord<T> {
  publicationSource?: string;
  deletedAt?: string;
}
export interface DocumentDraft<T extends Frontmatter = Frontmatter> {
  document: DocumentRecord<T>;
  branch: string | null;
  headSha: string;
  state: 'draft' | 'published' | 'unpublished-changes';
}
export interface DocumentSelection { id: string; branch: string; expectedHeadSha: string }
export interface DocumentStoreOptions<T extends Frontmatter> {
  forge: PublishingForge;
  author: CommitSignature;
  collection: string;
  schema: JSONSchema;
  defaultBranch?: string;
  beforePublish?: (document: DocumentRecord<T>) => void | Promise<void>;
  /** Explicit import adapter for an earlier on-disk format; writes replace it atomically. */
  legacy?: { filename: string; decode: (source: string, id: string) => StoredDocument<T> };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function publicDocument<T extends Frontmatter>(document: StoredDocument<T>): DocumentRecord<T> {
  const {publicationSource: _, deletedAt: __, ...value}=document;
  return value;
}
/** Schema-validated Markdown documents; Git is the authority for every lifecycle operation. */
export function createDocumentStore<T extends Frontmatter = Frontmatter>(options: DocumentStoreOptions<T>) {
  const { forge, author } = options;
  const main = options.defaultBranch ?? "main";
  const collection=options.collection;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(collection))throw new DocumentError('Invalid collection name','invalid');
  if(options.legacy && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.legacy.filename))throw new DocumentError('Invalid legacy filename','invalid');
  const codec=documentCodec<T>(options.schema);
  const prefix=`quiescent/${collection}/`;
  function directory(id:string) {if(!uuid.test(id))throw new DocumentError('Invalid document identifier','invalid');return `${collection}/${id}`;}
  const path=(id:string)=>`${directory(id)}/index.md`;
  const statePath=(id:string)=>`${directory(id)}/.quiescent.json`;
  const legacyPath=(id:string)=>`${directory(id)}/${options.legacy!.filename}`;
  function checkBranch(id:string,branch:string) {
    directory(id);
    if(!branch.startsWith(`${prefix}${id}/`) || !uuid.test(branch.slice(`${prefix}${id}/`.length)))throw new DocumentError('Invalid draft','invalid');
  }
  async function read(id: string, ref: string): Promise<StoredDocument<T> | null> {
    const file=await forge.getFile(path(id),ref);
    if(!file) {
      if(!options.legacy)return null;
      const old=await forge.getFile(legacyPath(id),ref);
      if(!old)return null;
      const imported=options.legacy.decode(old.content,id);
      codec.validate(imported);
      return imported;
    }
    const content=codec.parse(file.content);
    const stateFile=await forge.getFile(statePath(id),ref);
    const state=stateFile ? JSON.parse(stateFile.content) : {};
    if(!state || typeof state!=='object' || Array.isArray(state) || Object.keys(state).some(k=>!['publishedAt','publicationSource','deletedAt'].includes(k)) || Object.values(state).some(v=>typeof v!=='string'))
      throw new DocumentError('Invalid document state','invalid');
    return {...content,id,...state};
  }
  function checked(input:DocumentInput<T>):DocumentInput<T> {return codec.validate(input);}
  async function commit(branch:string,expectedHeadSha:string,document:StoredDocument<T>,message:string) {
    const {publishedAt,publicationSource,deletedAt}=document;
    const files:CommitFileChange[]=[
      {path:path(document.id),content:codec.stringify(document)},
      {path:statePath(document.id),content:JSON.stringify({publishedAt,publicationSource,deletedAt},null,2)+'\n'},
    ];
    if(options.legacy && await forge.getFile(legacyPath(document.id),expectedHeadSha))files.push({path:legacyPath(document.id),content:null});
    return forge.commitFiles({branch,expectedHeadSha,author,message,files});
  }
  async function getPublished(id: string): Promise<DocumentDraft<T> | null> {
    const headSha = await forge.getBranchSha(main);
    const document = await read(id, headSha);
    return document?.publishedAt && !document.deletedAt ? { document: publicDocument(document), branch: null, headSha, state: "published" } : null;
  }
  async function listPublished(): Promise<DocumentDraft<T>[]> {
    const headSha = await forge.getBranchSha(main);
    const entries = await forge.listDir(collection, headSha).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 404) return [];
      throw error;
    });
    const documents = await Promise.all(entries.filter(e => e.type === "dir" && uuid.test(e.name)).map(async e => {
      const document = await read(e.name, headSha);
      return document?.publishedAt && !document.deletedAt ? { document: publicDocument(document), branch: null, headSha, state: "published" as const } : null;
    }));
    return documents.filter((p): p is DocumentDraft<T> & {state:"published";branch:null} => p !== null);
  }
  async function activeDrafts(id?: string): Promise<DocumentDraft<T>[]> {
    const mainSha = await forge.getBranchSha(main);
    const branches = await forge.listBranches(id ? `${prefix}${id}/` : prefix);
    const result: DocumentDraft<T>[] = [];
    // Limit GitHub concurrency while avoiding one network waterfall per historical branch.
    for (let offset = 0; offset < branches.length; offset += 6) {
      const batch = await Promise.all(branches.slice(offset, offset + 6).map(async ({name, sha}) => {
        const documentId = name.slice(prefix.length).split("/")[0]!;
        try { checkBranch(documentId, name); } catch { return null; }
        if (await forge.isAncestor(sha, mainSha)) return null;
        if ((await read(documentId, mainSha))?.deletedAt) return null;
        const document = await read(documentId, sha);
        return document ? { document: publicDocument(document), branch: name, headSha: sha,
          state: document.publishedAt ? "unpublished-changes" as const : "draft" as const } : null;
      }));
      for (const document of batch) if (document) result.push(document);
    }
    return result;
  }

  async function start(document: DocumentRecord<T>): Promise<DocumentDraft<T>> {
    const sha = await forge.getBranchSha(main);
    const branch = `${prefix}${document.id}/${crypto.randomUUID()}`;
    await forge.createBranch(branch, sha);
    const result = await commit(branch, sha, document, "Save document draft");
    return { document: document, branch, headSha: result.sha, state: document.publishedAt ? "unpublished-changes" : "draft" };
  }
  async function startPublished(published: DocumentDraft<T>): Promise<DocumentDraft<T>> {
    // One deterministic branch per published document revision, independent of unrelated
    // main-branch commits. GitHub's create-ref and commit CAS arbitrate concurrent tabs.
    const file = await read(published.document.id, published.headSha);
    if (!file) throw new DocumentError("Document not found", "not_found");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(publicDocument(file)))))].map(b => b.toString(16).padStart(2, "0")).join("");
    const cycle = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    const branch = `${prefix}${published.document.id}/${cycle}`;
    try {
      await forge.createBranch(branch, published.headSha);
    } catch (error) {
      // Also covers a successful create whose response was lost. Never reset a ref.
      try { await forge.getBranchSha(branch); } catch { throw error; }
    }
    const head = await forge.getBranchSha(branch);
    const current = await read(published.document.id, head);
    if (current && JSON.stringify(current) === JSON.stringify(file)) {
      try {
        await commit(branch, head, published.document, "Save document draft");
      } catch (error) {
        // A racing initializer or writer won. Load its version instead of overwriting it.
        if (await forge.getBranchSha(branch) === head) throw error;
      }
    } else if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      // This exact cycle finished while the caller was opening it; resolve the new cycle.
      return getDraft(published.document.id);
    }
    return getDraft(published.document.id, branch);
  }
  async function createDocument(input:DocumentInput<T>):Promise<DocumentDraft<T>> {
    const value=checked(input);
    return start({...value,id:crypto.randomUUID()});
  }
  async function assertNotDeleted(id: string, mainSha?: string) {
    if ((await read(id, mainSha ?? await forge.getBranchSha(main)))?.deletedAt)
      throw new DocumentError("This document was deleted. Your local writing has been preserved.", "not_found");
  }
  async function getDraft(id: string, branch?: string): Promise<DocumentDraft<T>> {
    path(id);
    await assertNotDeleted(id);
    if (branch) {
      checkBranch(id, branch);
      const headSha = await forge.getBranchSha(branch);
      const document = await read(id, headSha);
      if (!document) throw new DocumentError("Draft not found", "not_found");
      return { document: publicDocument(document), branch, headSha, state: document.publishedAt ? "unpublished-changes" : "draft" };
    }
    const drafts = await activeDrafts(id);
    if (drafts[0]) return drafts[0];
    const published = await getPublished(id);
    if (!published) throw new DocumentError("Document not found", "not_found");
    return startPublished(published);
  }
  async function saveDraft(input: DocumentSelection & { document: DocumentInput<T> & {id?:string} }): Promise<DocumentDraft<T>> {
    checkBranch(input.id, input.branch);
    await assertNotDeleted(input.id);
    if (!input.document) throw new DocumentError("Document missing", "invalid");
    if (input.document.id !== undefined && input.id !== input.document.id) throw new DocumentError("Document identifier mismatch", "invalid");
    const head = await forge.getBranchSha(input.branch);
    if (head !== input.expectedHeadSha) throw new DocumentError("This draft has newer changes. Your writing has been preserved.", "conflict");
    const previous = await read(input.id, head);
    if (!previous) throw new DocumentError("Draft not found", "not_found");
    if (await forge.isAncestor(head, await forge.getBranchSha(main))) {
      throw new DocumentError("This draft was published. Reopen the document to continue editing.", "conflict");
    }
    const document = { ...checked(input.document), id:input.id, ...(previous.publishedAt ? { publishedAt: previous.publishedAt } : {}) };
    const result = await commit(input.branch, head, document, "Save document draft");
    return { document: document, branch: input.branch, headSha: result.sha, state: document.publishedAt ? "unpublished-changes" : "draft" };
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
    const requestedWasPrepared = published?.publicationSource && await forge.isAncestor(input.expectedHeadSha, mainSha)
      && (await read(input.id, input.expectedHeadSha))?.publicationSource === published.publicationSource;
    if (published && (published.publicationSource === input.expectedHeadSha || requestedWasPrepared)) {
      return { document: publicDocument(published), headSha: head, publishedSha: mainSha, state: "published" as const };
    }
    if (head !== input.expectedHeadSha && document.publicationSource !== input.expectedHeadSha) {
      throw new DocumentError("This draft has newer changes. Review them before publishing.", "conflict");
    }
    const comparison = await forge.compareCommits(mainSha, head);
    if (!comparison.files.length || comparison.files.some(f => ![path(input.id),statePath(input.id),...(options.legacy?[legacyPath(input.id)]:[])].includes(f.filename) || (f.previousFilename && ![path(input.id),statePath(input.id),...(options.legacy?[legacyPath(input.id)]:[])].includes(f.previousFilename)))) {
      throw new DocumentError("The draft contains unexpected changes and cannot be published.", "invalid");
    }
    await checked(document);
    await options.beforePublish?.(publicDocument(document));
    if (!document.publicationSource) {
      document = {...document, publishedAt:document.publishedAt ?? new Date().toISOString(), publicationSource:input.expectedHeadSha};
      head = (await commit(input.branch, head, document, "Prepare document publication")).sha;
    }
    const publicationSource = document.publicationSource;
    const result = await forge.mergeBranch(main, head);
    const visible = await read(input.id, result.sha);
    if (!visible || visible.publicationSource !== publicationSource) throw new DocumentError("Publication could not be confirmed. Retry safely.", "conflict");
    return { document: publicDocument(visible), headSha: head, publishedSha: result.sha, state: "published" as const };
  }
  async function deleteDocument(input: {id:string; branch?:string|null; expectedHeadSha:string}) {
    path(input.id);
    const mainSha=await forge.getBranchSha(main);
    const current=await read(input.id,mainSha);
    if (current?.deletedAt) return {id:input.id,document:publicDocument(current),headSha:mainSha,deleted:true as const};
    const previous=await read(input.id,input.expectedHeadSha);
    if (!previous) throw new DocumentError("Document not found","not_found");
    if (input.branch) {
      checkBranch(input.id,input.branch);
      if (await forge.getBranchSha(input.branch)!==input.expectedHeadSha)
        throw new DocumentError("This draft has newer changes. Reopen it before deleting.","conflict");
      // A concurrently published revision must not be removed by a stale draft tab.
      if (current?.publicationSource && !await forge.isAncestor(current.publicationSource,input.expectedHeadSha)
        && current.publicationSource!==input.expectedHeadSha)
        throw new DocumentError("This document was published since you opened it. Reopen it before deleting.","conflict");
    } else if (JSON.stringify(current)!==JSON.stringify(previous)) {
      throw new DocumentError("This document has newer changes. Reopen it before deleting.","conflict");
    }
    // The tombstone is authoritative across all retained branches and survives restarts.
    const result=await commit(main,mainSha,{...previous,body:"",deletedAt:new Date().toISOString()},"Delete document");
    return {id:input.id,document:publicDocument(previous),headSha:result.sha,deleted:true as const};
  }
  async function listDocuments(): Promise<DocumentDraft<T>[]> {
    const [drafts, published] = await Promise.all([activeDrafts(), listPublished()]);
    const ids = new Set(drafts.map(d => d.document.id));
    return [...drafts, ...published.filter(p => !ids.has(p.document.id))];
  }
  return {collection,schema:options.schema,createDocument,getDraft,saveDraft,publish,deleteDocument,getPublished,listPublished,listDocuments};
}
