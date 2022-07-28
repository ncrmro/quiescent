import fs from "fs/promises";
import { Document } from "./types";

/**
 * Parse the specified markdown file into our documented format
 * @param documentDirectory
 * @param documentFilename
 */
export async function parseDocument(
  documentDirectory: string,
  documentFilename: string
) {
  const [year, month, day, end] = documentFilename.split("_");
  const slug = end.replace(".md", "");

  let documentPath = `${documentDirectory}/${documentFilename}`;
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
    const tags = post.tags?.split(",") || [];
    if (post.title && post.description) {
      return {
        title: post.title,
        description: post.description,
        content: content.replace(match, ""),
        date: `${year}-${month}-${day}`,
        slug,
        tags,
      } as Document;
    }
  }
}
