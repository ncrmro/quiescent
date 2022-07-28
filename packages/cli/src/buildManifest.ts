import fs from "fs/promises";

const publicDirectory = `${process.cwd()}/public`;
const postDirectory = `${publicDirectory}/posts`;

interface Post {
  description: string;
  content: string;
  tags?: string[];
}

interface Manifest {
  posts: Record<string, Post>;
  tags: Record<string, number>;
}

export default async function () {
  const manifest: Manifest = { posts: {}, tags: {} };
  for (const document of await fs.readdir(postDirectory)) {
    let content;
    if (document.includes(".md")) {
      content = await fs.readFile(`${postDirectory}/${document}`, "utf8");
    } else {
      content = await fs.readFile(
        `${postDirectory}/${document}/document.md`,
        "utf8"
      );
    }
    const [year, month, data, end] = document.split("_");
    const slug = end.replace(".md", "");
    manifest.posts[slug] = { description: "", content, tags: [] };
    const tagsRegex = content.match(/(?<=tags: )[\w,]*/m);
    if (tagsRegex) {
      const tags = tagsRegex[0].split(",");
      tags.forEach((tag) => {
        manifest.tags[tag] ||= 0;
        manifest.tags[tag]++;
        manifest.posts[slug].tags.push(tag);
      });
    }
  }
  await fs.writeFile(
    `${publicDirectory}/posts.manifest.json`,
    JSON.stringify(manifest)
  );
}
