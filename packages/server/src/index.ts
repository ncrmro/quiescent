import fs from "fs/promises";
import { parseDocument } from "./parseDocument";
import { Manifest } from "./types";
import { useConfig } from "./config";

export async function buildManifest(documentDirectory: string) {
  const manifest: Manifest = { documents: {}, tags: {} };
  for (const documentFilename of await fs.readdir(documentDirectory)) {
    if (documentFilename === "manifest.json") continue;
    const doc = await parseDocument(documentDirectory, documentFilename);
    if (doc) {
      manifest.documents[doc.slug] = doc;
      doc.tags?.forEach((tag) => {
        manifest.tags[tag] ||= 0;
        manifest.tags[tag]++;
        manifest.documents[doc.slug].tags?.push(tag);
      });
    }
  }
  return manifest;
}

export async function getManifest(
  documentType: string,
  mode: "dynamic" | "filesystem"
): Promise<Manifest | undefined> {
  const config = useConfig();
  const documentConfig = config.documentTypes[documentType];
  if (!documentConfig) throw "Document type not found in config";

  if (mode === "dynamic") {
    return buildManifest(documentConfig.directory);
  }
  if (mode === "filesystem") {
    const manifest = JSON.parse(
      await fs.readFile(`${documentConfig.directory}/manifest.json`, "utf8")
    );
    return {
      documents: typeof manifest.posts === "object" ? manifest.posts : {},
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    };
  }
}

export async function getDocumentSlugs(
  documentType: string,
  mode: "dynamic" | "filesystem"
) {
  const manifest = await getManifest(documentType, mode);
  if (manifest) {
    return Object.keys(manifest);
  }
}

// export async function getDocumentBySlug(slug: string) {
//   return (await manifest).documents[slug];
// }

export async function documentBySlug(documentType: string, slug: string) {
  const config = useConfig();
  const documentConfig = config.documentTypes[documentType];
  if (!documentConfig) throw "Document type not found in config";
  const documentFilename = (await fs.readdir(documentConfig.directory)).find(
    (fileName) => fileName.includes(slug)
  );
  if (documentFilename) {
    return await parseDocument(documentConfig.directory, documentFilename);
  }
}

export * from "./parseDocument";
export * from "./types";
export { useConfig } from "./config";
