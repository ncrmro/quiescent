import fs from "fs/promises";
import { parseDocument } from "./parseDocument";
import { Manifest } from "./types";

const publicDirectory = `${process.cwd()}/public`;

function getDocumentDirectory(directory = "posts") {
  return `${publicDirectory}/${directory}/`;
}
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
  mode: "dynamic" | "filesystem"
): Promise<Manifest | undefined> {
  if (mode === "dynamic") {
    return buildManifest(getDocumentDirectory());
  }
  if (mode === "filesystem") {
    const manifest = JSON.parse(
      await fs.readFile(`${publicDirectory}/posts/manifest.json`, "utf8")
    );
    return {
      documents: typeof manifest.posts === "object" ? manifest.posts : {},
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    };
  }
}

// export async function getDocumentSlugs() {
//   return Object.keys(await manifest);
// }

// export async function getDocumentBySlug(slug: string) {
//   return (await manifest).documents[slug];
// }

export async function documentBySlug(slug: string) {
  const documentDirectory = getDocumentDirectory();
  const documentFilename = (await fs.readdir(documentDirectory)).find(
    (fileName) => fileName.includes(slug)
  );
  if (documentFilename) {
    return await parseDocument(documentDirectory, documentFilename);
  }
}

export * from "./parseDocument";
export * from "./types";
