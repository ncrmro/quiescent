import type { CommitFileChange, PublishingForge } from "@quiescent/git";
import { isAssetFilename } from "./content/assets.ts";
import type { DocumentRecord, StoredDocument } from "./contracts.ts";
import { documentCodec, type Frontmatter, type JSONSchema } from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";

export interface DocumentAssets<T extends Frontmatter> {
  prepare(
    document: DocumentRecord<T>,
    context: { directory: string; ref: string },
  ): Promise<Record<string, string>>;
}
export interface LayoutOptions<T extends Frontmatter> {
  forge: PublishingForge;
  collection: string;
  schema: JSONSchema;
  /** One folder segment. Supported placeholders: id, slug, createdAt:YYYY-MM-DD. */
  directoryTemplate?: string;
  assets?: DocumentAssets<T>;
  legacy?: { filename: string; decode: (source: string, id: string) => StoredDocument<T> };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const segment = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,219}$/;
export function documentLayout<T extends Frontmatter>(options: LayoutOptions<T>) {
  const { forge, collection } = options;
  const codec = documentCodec<T>(options.schema);
  const raw = documentCodec(true);
  const template = options.directoryTemplate ?? "{id}";
  if (
    !segment.test(
      template
        .replaceAll("{id}", "id")
        .replaceAll("{slug}", "slug")
        .replaceAll("{createdAt:YYYY-MM-DD}", "date"),
    )
  )
    throw new DocumentError("Invalid document directory template", "invalid");
  function checkId(id: string) {
    if (!uuid.test(id)) throw new DocumentError("Invalid document identifier", "invalid");
    return id;
  }
  const statePath = (id: string) => `${collection}/.quiescent/${checkId(id)}.json`;
  const oldDirectory = (id: string) => `${collection}/${checkId(id)}`;
  function folder(document: DocumentRecord<T>) {
    const slug = template.includes("{slug}")
      ? (document.frontmatter.slug ?? document.id)
      : document.id;
    if (typeof slug !== "string" || !segment.test(slug))
      throw new DocumentError("Invalid document slug", "invalid");
    const name = template
      .replaceAll("{id}", document.id)
      .replaceAll("{slug}", slug)
      .replaceAll(
        "{createdAt:YYYY-MM-DD}",
        (document.createdAt ?? document.publishedAt ?? new Date().toISOString()).slice(0, 10),
      );
    if (!segment.test(name)) throw new DocumentError("Invalid document directory", "invalid");
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
    const state = parseState(file.content);
    const name = state.directory?.slice(collection.length + 1);
    if (!state.directory?.startsWith(`${collection}/`) || !name || !segment.test(name))
      throw new DocumentError("Invalid document location", "invalid");
    return { directory: state.directory, state };
  }
  function decode(source: string, id: string) {
    const value = raw.parse(source);
    const { id: storedId, createdAt, ...frontmatter } = value.frontmatter;
    if (storedId !== undefined && storedId !== id)
      throw new DocumentError("Document identifier mismatch", "invalid");
    if (
      createdAt !== undefined &&
      (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)))
    )
      throw new DocumentError("Invalid creation date", "invalid");
    const content = codec.validate({ frontmatter: frontmatter as T, body: value.body });
    return { ...content, id, ...(typeof createdAt === "string" ? { createdAt } : {}) };
  }
  async function readLegacy(directory: string, id: string, ref: string) {
    if (!options.legacy) return null;
    const old = await forge.getFile(`${directory}/${options.legacy.filename}`, ref);
    if (!old) return null;
    const imported = options.legacy.decode(old.content, id);
    codec.validate(imported);
    return imported;
  }
  async function read(id: string, ref: string): Promise<StoredDocument<T> | null> {
    const { directory, state } = await location(id, ref);
    const file = await forge.getFile(`${directory}/index.md`, ref);
    if (!file) return readLegacy(directory, id, ref);
    const legacyState = state.directory
      ? null
      : await forge.getFile(`${directory}/.quiescent.json`, ref);
    const workflow = legacyState ? parseState(legacyState.content) : state;
    const document = decode(file.content, id);
    return {
      ...document,
      ...(workflow.publishedAt ? { publishedAt: workflow.publishedAt } : {}),
      ...(workflow.publicationSource ? { publicationSource: workflow.publicationSource } : {}),
      ...(workflow.deletedAt ? { deletedAt: workflow.deletedAt } : {}),
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
    const [current, old] = await Promise.all([
      entries(`${collection}/.quiescent`, ref),
      entries(collection, ref),
    ]);
    return [
      ...new Set(
        [...current.map((e) => e.name.replace(/\.json$/, "")), ...old.map((e) => e.name)].filter(
          (id) => uuid.test(id),
        ),
      ),
    ];
  }
  async function assertDestination(document: DocumentRecord<T>, ref: string) {
    const existing = await forge.getFile(`${folder(document)}/index.md`, ref);
    if (!existing) return;
    const id = raw.parse(existing.content).frontmatter.id;
    if (id !== document.id && folder(document) !== oldDirectory(document.id))
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
          "*.[pP][nN][gG] filter=lfs diff=lfs merge=lfs -text\n*.[jJ][pP][gG] filter=lfs diff=lfs merge=lfs -text\n*.[jJ][pP][eE][gG] filter=lfs diff=lfs merge=lfs -text\n*.[wW][eE][bB][pP] filter=lfs diff=lfs merge=lfs -text\n",
      });
    for (const entry of await entries(previous.directory, ref)) {
      const remove =
        previous.directory !== directory ||
        entry.name === ".quiescent.json" ||
        entry.name === options.legacy?.filename;
      if (remove && allowedName(entry.name)) files.push({ path: entry.path, content: null });
    }
    return files;
  }
  function allowedName(name: string) {
    return (
      ["index.md", ".quiescent.json", ".gitattributes", options.legacy?.filename].includes(name) ||
      isAssetFilename(name)
    );
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
  return { read, changes, ids, location, assertScope, assertDestination, checkId };
}
