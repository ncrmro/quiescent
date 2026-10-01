import type { DocumentRecord, Frontmatter, JSONSchema } from "@quiescent/server/documents";
export type Collection = "posts" | "recipes";
export interface ExampleMetadata extends Frontmatter {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  headerImage: string | null;
}
const common = {
  title: { type: "string", title: "Title", maxLength: 300 },
  slug: { type: "string", title: "Slug", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  description: { type: "string", title: "Description" },
  tags: { type: "array", title: "Tags", items: { type: "string" } },
  headerImage: { type: ["string", "null"], title: "Image" },
};
export function collectionSchema(collection: Collection): JSONSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(common),
    properties: {
      ...common,
      ...(collection === "recipes"
        ? {
            ingredients: {
              type: "array",
              title: "Ingredients",
              items: {
                type: "object",
                required: ["name", "quantity"],
                properties: { name: { type: "string" }, quantity: { type: "string" } },
              },
            },
            preparationMinutes: {
              type: "integer",
              title: "Preparation time (minutes)",
              minimum: 0,
            },
          }
        : {}),
    },
  } as JSONSchema;
}
export function initialDocument(collection: Collection) {
  return {
    frontmatter: {
      title: "",
      description: "",
      slug: `draft-${Date.now()}`,
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
