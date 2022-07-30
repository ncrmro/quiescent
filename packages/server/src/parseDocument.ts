import fs from "fs/promises";

export interface Document {
  title: string;
  description: string;
  content: string;
  date: string;
  slug: string;
  tags?: string[];
}

/**
 * Parse the specified markdown file into our document format
 * @param documentDirectory
 * @param documentFilename
 */
export async function parseDocument(
  documentDirectory: string,
  documentFilename: string
) {
  const documentMatch = documentFilename.match(
    /(?<year>\d{4})_(?<month>\d{2})_(?<date>\d{2})_(?<slug>[A-Za-z0-9-]*)[\.md|$]/
  );
  if (!documentMatch?.groups)
    throw `Document file name does not match YYYY_MM_DD-document-slug ${documentFilename}`;
  // console.log(re?.groups);
  const { year, month, date, slug } = documentMatch.groups;

  // If document is in a folder with assets
  if (!documentFilename.includes(".md")) {
    documentFilename = `${documentFilename}/document.md`;
  }
  let content = await fs.readFile(
    `${documentDirectory}/${documentFilename}`,
    "utf8"
  );

  // Extract the header from the file contents
  const match = content.match(/---\n((\w*:) .*\n)*---/)?.[0];
  if (!match) throw `Error parsing the header for ${documentFilename}`;

  // Remove the header from markdown file contents
  content = content.replace(match, "");

  const document: Record<string, string> = {};
  // For each attribute in the header file add to the post object
  for (const [_, k, v] of match.matchAll(/^(?<key>\w*): (?<value>.*)$/gm)) {
    document[k] = v;
  }
  const tags = document.tags?.split(",") || [];
  if (document.title && document.description) {
    return {
      title: document.title,
      description: document.description,
      content,
      date: `${year}-${month}-${date}`,
      slug,
      tags,
    } as Document;
  }
}
