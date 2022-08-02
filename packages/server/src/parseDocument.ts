import fs from "fs/promises";
import { DocumentConfig } from "./config";

export interface Document {
  title: string;
  description: string;
  content: string;
  date: string;
  slug: string;
  tags?: string[];
}

/**
 * Parse the header from the markdown file.
 * @param documentConfig
 * @param documentFilename
 */
export async function parseDocument(
  documentConfig: DocumentConfig,
  documentFilename: string
) {
  const documentMatch = documentFilename.match(
    /(?<year>\d{4})_(?<month>\d{2})_(?<date>\d{2})_(?<slug>[A-Za-z0-9-]*)[\.md]?/
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
    `${documentConfig.directory}/${documentFilename}`,
    "utf8"
  );

  // Extract the header from the file contents
  const match = content.match(/---\n((\w*:) .*\n)*---/)?.[0];
  if (!match) throw `Error parsing the header for ${documentFilename}`;

  // Remove the header from markdown file contents
  content = content.replace(match, "");

  const requiredKeys: string[] = [];
  // Since we are converting from array, convert to map
  const additionalKeys = new Map(
    documentConfig.additionalKeys.map(({ key, ...config }) => {
      if (config.required) requiredKeys.push(key);
      return [key, config];
    })
  );

  const document: Record<string, string> = {};

  // For each attribute in the header file add to the post object
  for (const [_, k, v] of match.matchAll(/^(?<key>\w*): (?<value>.*)$/gm)) {
    // On first loop we should make sure the key is defined in the documentConfig
    if (!additionalKeys.get(k))
      throw `Key ${k} in ${documentFilename} was not defined in your config`;
    document[k] = v;
  }

  for (const key in additionalKeys) {
    if (!(key in document)) {
      throw `Required key ${key} was not found in document ${documentFilename}`;
    }
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
