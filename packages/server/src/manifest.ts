import fs from "fs/promises";
import { Document, parseDocument } from "./parseDocument";
import { DocumentConfig, useConfig } from "./config";

interface Manifest<D extends Document = Document> {
  documents: Record<string, D>;
  tags: Record<string, string[]>;
}

export async function buildManifest<D extends Document = Document>(
  documentConfig: DocumentConfig
) {
  const manifest: Manifest<D> = { documents: {}, tags: {} };
  for (const documentFilename of await fs.readdir(documentConfig.directory)) {
    if (documentFilename === "manifest.json") continue;
    const doc = await parseDocument<D>(documentConfig, documentFilename);
    if (doc) {
      manifest.documents[doc.slug] = doc;
      doc.tags?.forEach((tag) => {
        manifest.tags[tag] ||= [];
        manifest.tags[tag].push(doc.slug);
        manifest.documents[doc.slug].tags?.push(tag);
      });
    }
  }
  return manifest;
}

export async function getManifest<D extends Document = Document>(
  documentType: string,
  mode: "dynamic" | "filesystem"
): Promise<Manifest<D>> {
  const config = useConfig();
  const documentConfig = config.documentTypes[documentType];
  if (!documentConfig) throw "Document type not found in config";

  if (mode === "dynamic") {
    return buildManifest<D>(documentConfig);
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
  throw "Mode was not correctly defined";
}
