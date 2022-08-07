import fs from "fs/promises";
import { DocumentConfig } from "./config";

export const defaultKeys = ["title", "content", "tags", "slug", "date"];

/**
 * This function type guards our generic document type
 * @param documentConfig
 * @param documentFilename
 * @param object
 */
function isDocument<D = Document>(
  documentConfig: DocumentConfig,
  documentFilename: string,
  object: any
): object is D {
  const additionalKeys = documentConfig.additionalKeys;
  if (!additionalKeys) return true;
  // Find any keys that aren't in the defaults or additional keys
  const unknownKey = Object.keys(object).find(
    (key) => !defaultKeys.includes(key) && !(key in additionalKeys)
  );
  if (unknownKey)
    throw `Key ${unknownKey} was found in document ${documentFilename}`;

  for (const [key, atr] of Object.entries(additionalKeys)) {
    // If key is in object but not correct type return false
    if (key in object && typeof object[key] !== atr.type) {
      throw `Key ${key} was not the correct type in document ${documentFilename}`;
    }
    // If attribute required and not in object return false
    if (atr.required && !(key in object)) {
      throw `Required key ${key} was not found in document ${documentFilename}`;
    }
  }
  return true;
}

export interface Document {
  title: string;
  content: string;
  date: string;
  slug: string;
  tags?: string[];
}

/**
 * Extract the date and slug from the document file name
 * @param documentFilename
 */
function parseDocumentFilename(documentFilename: string) {
  const documentMatch = documentFilename.match(
    /(?<year>\d{4})_(?<month>\d{2})_(?<date>\d{2})_(?<slug>[A-Za-z0-9-]*)[\.md]?/
  );
  if (!documentMatch?.groups)
    throw `Document file name does not match YYYY_MM_DD-document-slug ${documentFilename}`;
  const { year, month, date, slug } = documentMatch.groups;
  return { year, month, date, slug };
}

/**
 * Parse the header from the markdown file.
 * @param documentConfig
 * @param documentFilename
 */
export async function parseDocument<D extends Document = Document>(
  documentConfig: DocumentConfig,
  documentFilename: string
): Promise<D> {
  const { year, month, date, slug } = parseDocumentFilename(documentFilename);

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
  if (!match) throw new Error(`Unable to parse header for ${documentFilename}`);

  const document: Record<string, string | string[]> = {
    slug,
    date: `${year}-${month}-${date}`,
    // Remove the header from markdown file contents
    content: content.replace(match, ""),
  };

  // For each attribute in the header file add to the post object
  for (const [_, k, v] of match.matchAll(/^(?<key>\w*): (?<value>.*)$/gm)) {
    // Make sure only keys defined in the config are allowed
    document[k] = v;
  }
  if (typeof document.tags === "string") {
    document.tags = document.tags?.split(",") || [];
  }

  if (!isDocument<D>(documentConfig, documentFilename, document))
    throw "Document was not parseable";
  return document;
}
