import type { DocumentRecord, Frontmatter, JSONSchema } from "@quiescent/server/documents";
import configuration from "../../quiescent.config.json" with { type: "json" };
export type Collection = keyof typeof configuration.collections;
export interface ExampleMetadata extends Frontmatter {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  headerImage: string | null;
}
export function collectionSchema(collection: Collection): JSONSchema {
  return configuration.collections[collection].schema as JSONSchema;
}
export function initialDocument(collection: Collection) {
  return {
    frontmatter: {
      title: "",
      description: "",
      slug: "",
      tags: [],
      headerImage: null,
      ...(collection === "recipes" ? { ingredients: [], preparationMinutes: 0 } : {}),
    },
    body: "",
  };
}
export const documentPath = (collection: Collection, document: DocumentRecord) =>
  `/${collection}/${encodeURIComponent(String(document.frontmatter.slug))}`;
export const indexPaths = (collection: Collection) =>
  collection === "posts" ? ["/"] : ["/recipes"];

/** The example chooses title-based slugs; the editor remains schema agnostic. */
export function titleSlug(title: unknown): string {
  const slug = String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "new" ? "new-document" : slug;
}
export function deriveSlug(current: Record<string, unknown>) {
  if (current.slug) return {};
  const slug = titleSlug(current.title);
  return slug ? { slug } : {};
}
