import fs from "fs/promises";
import { Document, parseDocument } from "./parseDocument";
import { useConfig } from "./config";

export interface Manifest {
  documents: Record<string, Document>;
  tags: Record<string, string[]>;
}

export async function buildManifest(documentDirectory: string) {
  const manifest: Manifest = { documents: {}, tags: {} };
  for (const documentFilename of await fs.readdir(documentDirectory)) {
    if (documentFilename === "manifest.json") continue;
    const doc = await parseDocument(documentDirectory, documentFilename);
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
