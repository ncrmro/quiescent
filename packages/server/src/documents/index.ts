import { getManifest } from "../manifest";
import { useConfig } from "../config";
import fs from "fs/promises";
import { parseDocument } from "../parseDocument";

export async function getDocuments(
  documentType: string,
  mode: "dynamic" | "filesystem",
  category?: string
) {
  const manifest = await getManifest(documentType, mode);
  let documents = Object.values(manifest.documents);
  if (category) {
    documents = manifest.tags[category].map(
      (documentSlug) => manifest.documents[documentSlug]
    );
  }
  documents.sort((a, b) => {
    return (
      new Date(b.date).getMilliseconds() - new Date(a.date).getMilliseconds()
    );
  });
  return documents.reverse();
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

export async function getDocumentBySlug(documentType: string, slug: string) {
  const config = useConfig();
  const documentConfig = config.documentTypes[documentType];
  if (!documentConfig) throw "Document type not found in config";
  const documentFilename = (await fs.readdir(documentConfig.directory)).find(
    (fileName) => fileName.includes(slug)
  );
  if (documentFilename) {
    return await parseDocument(documentConfig, documentFilename);
  }
}
