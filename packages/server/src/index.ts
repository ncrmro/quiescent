import fs from "fs/promises";
import { Document, parseDocument } from "./parseDocument";
import { useConfig } from "./config";
import { getManifest } from "./manifest";

export async function getDocumentSlugs(
  documentType: string,
  mode: "dynamic" | "filesystem"
) {
  const manifest = await getManifest(documentType, mode);
  if (manifest) {
    return Object.keys(manifest);
  }
}

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

export async function getDocuments(
  documentType: string,
  mode: "dynamic" | "filesystem",
  category?: string
) {
  const manifest = await getManifest(documentType, mode);
  if (category) {
    const slugs = manifest.tags[category];
    return slugs.reduce<Record<string, Document>>((acc, slug) => {
      acc[slug] = manifest.documents[slug];
      return acc;
    }, {});
  }
  return manifest.documents;
}

export * from "./manifest";
export * from "./parseDocument";
export * from "./config";
