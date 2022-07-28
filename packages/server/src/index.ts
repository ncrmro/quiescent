import fs from "fs/promises";

const publicDirectory = `${process.cwd()}/public`;

export async function getManifest() {
  const manifest = JSON.parse(
    await fs.readFile(`${publicDirectory}/posts.manifest.json`, "utf8")
  );
  return {
    posts: typeof manifest.posts === "object" ? manifest.posts : {},
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
  };
}

const manifest = getManifest();

export async function getDocumentSlugs() {
  return Object.keys(await manifest);
}

export async function getDocumentBySlug(slug: string) {
  return { slug, ...(await manifest).posts[slug] };
}
