import type { DocumentDraft } from "./contracts.ts";
import type { JSONSchema } from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";
export type DocumentScalar = string | number | boolean | null;
export interface DocumentQuery {
  id?: string;
  slug?: string;
  where?: Array<{ field: string; op: "eq" | "lt" | "lte" | "gt" | "gte"; value: DocumentScalar }>;
  orderBy?: Array<{ field: string; direction?: "asc" | "desc" }>;
  limit?: number;
  offset?: number;
}
const builtins = new Set(["id", "slug", "createdAt", "publishedAt"]);
export function validateDocumentIndexes(indexes: string[], schema: JSONSchema) {
  if (indexes.length > 16 || new Set(indexes).size !== indexes.length)
    throw new DocumentError("Declare at most 16 unique scalar indexes", "invalid");
  for (const field of indexes) {
    const property = typeof schema === "object" ? schema.properties?.[field] : undefined;
    const types = property && typeof property === "object" ? property.type : undefined;
    const scalar = Array.isArray(types) ? types.filter((type) => type !== "null") : [types];
    if (
      !/^[A-Za-z][A-Za-z0-9_]*$/.test(field) ||
      scalar.length !== 1 ||
      !["string", "number", "integer", "boolean"].includes(String(scalar[0]))
    )
      throw new DocumentError(
        `Index ${field} needs a declared scalar JSON Schema property`,
        "invalid",
      );
  }
}
export function validateDocumentQuery(query: DocumentQuery, indexes: string[]) {
  for (const field of [
    ...(query.where ?? []).map((item) => item.field),
    ...(query.orderBy ?? []).map((item) => item.field),
  ])
    if (!builtins.has(field) && !indexes.includes(field))
      throw new DocumentError(`Query field ${field} is not indexed`, "invalid");
  if ((query.where?.length ?? 0) > 16 || (query.orderBy?.length ?? 0) > 4)
    throw new DocumentError("Query has too many conditions", "invalid");
  for (const item of query.where ?? []) validateCondition(item);
  for (const order of query.orderBy ?? []) validateDirection(order.direction);
  for (const value of [query.limit, query.offset]) validatePagination(value);
}
function validateCondition(item: NonNullable<DocumentQuery["where"]>[number]) {
  const scalar = item.value === null || ["string", "number", "boolean"].includes(typeof item.value);
  const finite = typeof item.value !== "number" || Number.isFinite(item.value);
  if (!["eq", "lt", "lte", "gt", "gte"].includes(item.op) || !scalar || !finite)
    throw new DocumentError("Invalid scalar query", "invalid");
}
function validateDirection(direction?: string) {
  if (direction && !["asc", "desc"].includes(direction))
    throw new DocumentError("Invalid query direction", "invalid");
}
function validatePagination(value?: number) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
    throw new DocumentError("Invalid query pagination", "invalid");
}
function matches(document: DocumentDraft, condition: NonNullable<DocumentQuery["where"]>[number]) {
  const left = fieldValue(document, condition.field);
  const order = compare(left, condition.value);
  if (condition.op === "eq") return left === condition.value;
  if (left === null || condition.value === null) return false;
  const result = { lt: order < 0, lte: order <= 0, gt: order > 0, gte: order >= 0 };
  return result[condition.op];
}
function fieldValue(document: DocumentDraft, field: string): DocumentScalar {
  const value =
    field === "id"
      ? document.document.id
      : field === "createdAt"
        ? document.document.createdAt
        : field === "publishedAt"
          ? document.document.publishedAt
          : document.document.frontmatter[field];
  return value === undefined ? null : (value as DocumentScalar);
}
function compare(left: DocumentScalar, right: DocumentScalar) {
  return left === right ? 0 : left === null ? -1 : right === null ? 1 : left < right ? -1 : 1;
}
export function selectDocuments(documents: DocumentDraft[], query: DocumentQuery = {}) {
  let result = documents.filter(
    (document) =>
      (query.id === undefined || document.document.id === query.id) &&
      (query.slug === undefined || document.document.frontmatter.slug === query.slug),
  );
  for (const condition of query.where ?? [])
    result = result.filter((document) => matches(document, condition));
  result.sort((a, b) => {
    for (const order of query.orderBy ?? []) {
      const value = compare(fieldValue(a, order.field), fieldValue(b, order.field));
      if (value) return order.direction === "desc" ? -value : value;
    }
    return (
      a.document.id.localeCompare(b.document.id) || (a.branch ?? "").localeCompare(b.branch ?? "")
    );
  });
  return result.slice(
    query.offset ?? 0,
    query.limit === undefined ? undefined : (query.offset ?? 0) + query.limit,
  );
}
export function documentCacheView(scope: string, collection: string, view: "published" | "drafts") {
  return JSON.stringify(["quiescent-documents-v2", scope, collection, view]);
}
export function cacheScope(key: string): {
  scope: string;
  collection: string;
  view: "published" | "drafts" | "all";
} {
  try {
    const parts: unknown = JSON.parse(key);
    if (
      Array.isArray(parts) &&
      parts.length === 4 &&
      parts[0] === "quiescent-documents-v2" &&
      typeof parts[1] === "string" &&
      typeof parts[2] === "string" &&
      ["published", "drafts"].includes(parts[3])
    )
      return { scope: parts[1], collection: parts[2], view: parts[3] };
  } catch {
    /* Opaque legacy test keys select all versions. */
  }
  return { scope: key, collection: "", view: "all" };
}
