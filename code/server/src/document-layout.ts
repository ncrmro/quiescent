import type { CommitFileChange, PublishingForge } from "@quiescent/git";
import { isAssetFilename } from "./content/assets.ts";
import type { DocumentRecord, StoredDocument } from "./contracts.ts";
import { documentCodec, type Frontmatter, type JSONSchema } from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";
import { documentDirectory } from "./document-naming.ts";

export interface DocumentAssets<T extends Frontmatter> {
  prepare(
    document: DocumentRecord<T>,
    context: { directory: string; ref: string },
  ): Promise<Record<string, string>>;
}
export interface LayoutOptions<T extends Frontmatter> {
  forge: PublishingForge;
  collection: string;
  directory?: string;
  schema: JSONSchema;
  /** Storage basename, independent of browser routes. Defaults to the document UUID. */
  filename?: (document: DocumentRecord<T>) => string;
  assets?: DocumentAssets<T>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const segment = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,219}$/;
export function documentLayout<T extends Frontmatter>(options: LayoutOptions<T>) {
  const { forge } = options;
  const collection = documentDirectory(options.directory ?? options.collection);
  const codec = documentCodec<T>(options.schema);
  const raw = documentCodec(true);
  function checkId(id: string) {
    if (!uuid.test(id)) throw new DocumentError("Invalid document identifier", "invalid");
    return id;
  }
  const statePath = (id: string) => `${collection}/.quiescent/${checkId(id)}.json`;
  const oldDirectory = (id: string) => `${collection}/${checkId(id)}`;
  function folder(document: DocumentRecord<T>) {
    const name = options.filename ? options.filename(document) : document.id;
    if (typeof name !== "string" || !segment.test(name))
      throw new DocumentError("Invalid document directory", "invalid");
    return `${collection}/${name}`;
  }
  function parseState(source: string) {
    const value: unknown = JSON.parse(source);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((v) => typeof v !== "string")
    )
      throw new DocumentError("Invalid document state", "invalid");
    const state = value as Record<string, string>;
    return state;
  }
  async function location(id: string, ref: string) {
    const file = await forge.getFile(statePath(id), ref);
    if (!file) return { directory: oldDirectory(id), state: {} as Record<string, string> };
    return parseLocation(file.content);
  }
  function parseLocation(content: string) {
    const state = parseState(content);
    const name = state.directory?.slice(collection.length + 1);
    if (!state.directory?.startsWith(`${collection}/`) || !name || !segment.test(name))
      throw new DocumentError("Invalid document location", "invalid");
    return { directory: state.directory, state };
  }
  function decode(source: string, id: string) {
    const value = raw.parse(source);
    const { id: storedId, createdAt, ...frontmatter } = value.frontmatter;
    if (storedId !== id) throw new DocumentError("Document identifier mismatch", "invalid");
    if (
      typeof createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      new Date(createdAt).toISOString().slice(0, 10) !== createdAt
    )
      throw new DocumentError("Invalid creation date", "invalid");
    const content = codec.validate({ frontmatter: frontmatter as T, body: value.body });
    return { ...content, id, createdAt };
  }
  async function readMany(
    requests: Array<{ id: string; ref: string }>,
    authoritativeRef?: string,
  ): Promise<Array<StoredDocument<T> | null>> {
    const getFiles = (files: Array<{ path: string; ref: string }>) =>
      forge.getFiles
        ? forge.getFiles(files)
        : Promise.all(files.map(({ path, ref }) => forge.getFile(path, ref)));
    const states = await getFiles(requests.map(({ id, ref }) => ({ path: statePath(id), ref })));
    const locations = states.map((file) => (file ? parseLocation(file.content) : null));
    // Main's tombstones exclude every revision before Markdown schema validation.
    const deleted = new Set(
      requests.flatMap(({ id, ref }, i) =>
        ref === authoritativeRef && locations[i]?.state.deletedAt ? [id] : [],
      ),
    );
    for (let i = 0; i < requests.length; i++) {
      if (deleted.has(requests[i]!.id)) locations[i] = null;
    }

    const present = requests.flatMap(({ ref }, i) =>
      locations[i] ? [{ path: `${locations[i]!.directory}/index.md`, ref }] : [],
    );
    const files = await getFiles(present);
    let index = 0;
    return requests.map(({ id }, i) => {
      const location = locations[i];
      if (!location) return null;
      const file = files[index++];
      if (!file) return null;
      const workflow = location.state;
      return {
        ...decode(file.content, id),
        ...(workflow.publishedAt ? { publishedAt: workflow.publishedAt } : {}),
        ...(workflow.publicationSource ? { publicationSource: workflow.publicationSource } : {}),
        ...(workflow.deletedAt ? { deletedAt: workflow.deletedAt } : {}),
      };
    });
  }
  async function read(id: string, ref: string): Promise<StoredDocument<T> | null> {
    // Single-document lifecycle operations retain the adapter's direct read path.
    const { directory, state } = await location(id, ref);
    if (!state.directory) return null;
    const file = await forge.getFile(`${directory}/index.md`, ref);
    if (!file) return null;
    return {
      ...decode(file.content, id),
      ...(state.publishedAt ? { publishedAt: state.publishedAt } : {}),
      ...(state.publicationSource ? { publicationSource: state.publicationSource } : {}),
      ...(state.deletedAt ? { deletedAt: state.deletedAt } : {}),
    };
  }
  async function entries(path: string, ref: string) {
    return forge.listDir(path, ref).catch((error: unknown) => {
      if (error && typeof error === "object" && "status" in error && error.status === 404)
        return [];
      throw error;
    });
  }
  async function ids(ref: string) {
    const current = await entries(`${collection}/.quiescent`, ref);
    return current.map((entry) => entry.name.replace(/\.json$/, "")).filter((id) => uuid.test(id));
  }
  async function assertDestination(document: DocumentRecord<T>, ref: string) {
    const existing = await forge.getFile(`${folder(document)}/index.md`, ref);
    if (!existing) return;
    const id = raw.parse(existing.content).frontmatter.id;
    if (id !== document.id)
      throw new DocumentError(
        "Another document already uses this folder. Choose a different slug.",
        "conflict",
      );
  }
  async function changes(document: StoredDocument<T>, ref: string): Promise<CommitFileChange[]> {
    await assertDestination(document, ref);
    const previous = await location(document.id, ref);
    const directory = folder(document);
    const assets =
      (await options.assets?.prepare(document, { directory: previous.directory, ref })) ?? {};
    const content = raw.stringify({
      frontmatter: { ...document.frontmatter, id: document.id, createdAt: document.createdAt },
      body: document.body,
    });
    const files: CommitFileChange[] = [
      { path: `${directory}/index.md`, content },
      {
        path: statePath(document.id),
        content: `${JSON.stringify({ directory, publishedAt: document.publishedAt, publicationSource: document.publicationSource, deletedAt: document.deletedAt })}\n`,
      },
      ...Object.entries(assets).map(([name, content]) => {
        if (!isAssetFilename(name)) throw new DocumentError("Invalid asset filename", "invalid");
        return { path: `${directory}/${name}`, content };
      }),
    ];
    if (Object.keys(assets).length)
      files.push({
        path: `${directory}/.gitattributes`,
        content:
          "*.[pP][nN][gG] filter=lfs diff=lfs merge=lfs -text\n*.[jJ][pP][gG] filter=lfs diff=lfs merge=lfs -text\n*.[jJ][pP][eE][gG] filter=lfs diff=lfs merge=lfs -text\n*.[wW][eE][bB][pP] filter=lfs diff=lfs merge=lfs -text\n*.[gG][iI][fF] filter=lfs diff=lfs merge=lfs -text\n",
      });
    for (const entry of await entries(previous.directory, ref)) {
      const remove = previous.directory !== directory;
      if (remove && allowedName(entry.name)) files.push({ path: entry.path, content: null });
    }
    return files;
  }
  function allowedName(name: string) {
    return ["index.md", ".gitattributes"].includes(name) || isAssetFilename(name);
  }
  async function assertScope(id: string, main: string, head: string) {
    const [before, after, comparison] = await Promise.all([
      location(id, main),
      location(id, head),
      forge.compareCommits(main, head),
    ]);
    const directories = new Set([before.directory, after.directory]);
    function allowed(path: string) {
      if (path === statePath(id)) return true;
      const slash = path.lastIndexOf("/");
      return directories.has(path.slice(0, slash)) && allowedName(path.slice(slash + 1));
    }
    if (
      !comparison.files.length ||
      comparison.files.some(
        (f) => !allowed(f.filename) || (f.previousFilename && !allowed(f.previousFilename)),
      )
    )
      throw new DocumentError(
        "The draft contains unexpected changes and cannot be published.",
        "invalid",
      );
  }
  return { read, readMany, changes, ids, location, assertScope, assertDestination, checkId };
}
