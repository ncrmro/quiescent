import { type LfsStorage, lfsPointer, type PublishingForge, parseLfsPointer } from "@quiescent/git";
import { assetContentType, isAssetFilename } from "./content/assets.ts";
import type { DocumentRecord } from "./contracts.ts";
import type { Frontmatter } from "./document-codec.ts";
import type { MediaStorage } from "./media.ts";
import { MediaError } from "./media.ts";

/** Git owns pointers and revision selection; delivery storage is reconstructible. */
export function createDocumentMedia<T extends Frontmatter>(options: {
  forge: PublishingForge;
  delivery: MediaStorage;
  lfs: LfsStorage;
  references: (document: DocumentRecord<T>) => string[];
}) {
  const { forge, delivery, lfs } = options;
  async function hydrate(id: string, name: string, pointer: string) {
    const object = parseLfsPointer(pointer);
    const cached = await delivery.read(id, object.oid);
    if (cached) {
      await cached.body.cancel();
      return object;
    }
    const bytes = await lfs.download(object);
    await delivery.restore(id, object.oid, bytes, assetContentType(name));
    return object;
  }
  return {
    async prepare(document: DocumentRecord<T>, context: { directory: string; ref: string }) {
      const result: Record<string, string> = {};
      // Retain every original, even if it is currently absent from the body/header.
      // Folder renames must move those pointers instead of deleting the archive.
      const entries = await forge
        .listDir(context.directory, context.ref)
        .catch((error: unknown) => {
          if (error && typeof error === "object" && "status" in error && error.status === 404)
            return [];
          throw error;
        });
      const names = new Set([
        ...entries.map((entry) => entry.name).filter(isAssetFilename),
        ...options.references(document),
      ]);
      for (const name of names) {
        if (!isAssetFilename(name))
          throw new MediaError("Images must use a filename within this document.");
        const existing = await forge.getFile(`${context.directory}/${name}`, context.ref);
        if (existing) {
          await hydrate(document.id, name, existing.content);
          result[name] = existing.content;
          continue;
        }
        const uploaded = await delivery.read(document.id, name);
        if (!uploaded) throw new MediaError("Upload this image before saving the document.", 409);
        const bytes = await new Response(uploaded.body).arrayBuffer();
        const object = await lfs.upload(bytes);
        await delivery.restore(document.id, object.oid, bytes, assetContentType(name));
        result[name] = lfsPointer(object);
      }
      return result;
    },
    async read(id: string, name: string, context: { directory: string; ref: string }) {
      if (!isAssetFilename(name)) throw new MediaError("Invalid image filename");
      const file = await forge.getFile(`${context.directory}/${name}`, context.ref);
      if (!file) return null;
      const object = await hydrate(id, name, file.content);
      return delivery.read(id, object.oid);
    },
  };
}
