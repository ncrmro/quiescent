import fs from "fs/promises";

const publicDirectory = `${process.cwd()}/public`;

function getDocumentDirectory(directory = "posts") {
  return `${publicDirectory}/${directory}/`;
}
export async function getManifest() {
  const manifest = JSON.parse(
    await fs.readFile(`${publicDirectory}/posts/manifest.json`, "utf8")
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

interface Document {
  description: string;
  content: string;
  tags?: string[];
}

async function parseDocument(documentPath: string) {
  if (!documentPath.includes(".md")) {
    documentPath = `${documentPath}/document.md`;
  }
  const content = await fs.readFile(documentPath, "utf8");
  const match = content.match(/---\n((\w*:) .*\n)*---/)?.[0];
  if (match) {
    const post: Record<string, string> = {};
    for (const [_, k, v] of match.matchAll(/^(?<key>\w*): (?<value>.*)$/gm)) {
      post[k] = v;
    }
    if (post.description) {
      return {
        description: post.description,
        content: content.replace(match, ""),
        tags: [],
      };
    }
  }
}

export async function documentBySlug(slug: string) {
  const documentDirectory = getDocumentDirectory();
  const documentFilename = (await fs.readdir(documentDirectory)).find(
    (fileName) => fileName.includes(slug)
  );
  return await parseDocument(`${documentDirectory}/${documentFilename}`);
}
