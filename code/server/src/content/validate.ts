import { isAssetFilename } from "./assets.ts";
import { mediaPattern, record, safeLink, type WritingDocument, type WritingMark } from "./model.ts";

const blocks = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "image",
  "horizontalRule",
]);
const inline = new Set(["text", "hardBreak"]);
function supported(type: string, parent?: string) {
  if (!parent) return type === "doc";
  if (["doc", "blockquote", "listItem"].includes(parent)) return blocks.has(type);
  if (["bulletList", "orderedList"].includes(parent)) return type === "listItem";
  if (["paragraph", "heading"].includes(parent)) return inline.has(type);
  return false;
}
function imageAttributes(attrs: Record<string, unknown>) {
  if (
    typeof attrs.src !== "string" ||
    !(mediaPattern.test(attrs.src) || isAssetFilename(attrs.src))
  )
    throw new Error("Invalid image reference");
  return {
    src: attrs.src,
    alt: typeof attrs.alt === "string" ? attrs.alt.slice(0, 2000) : "",
    title: typeof attrs.title === "string" ? attrs.title.slice(0, 2000) : null,
  };
}
function attributes(type: string, value: unknown): Record<string, unknown> | undefined {
  if (!["heading", "orderedList", "image"].includes(type)) return undefined;
  const attrs = value === undefined ? {} : record(value);
  switch (type) {
    case "heading":
      if (typeof attrs.level !== "number" || ![1, 2, 3].includes(attrs.level))
        throw new Error("Unsupported heading");
      return { level: attrs.level };
    case "orderedList":
      return {
        start:
          typeof attrs.start === "number" && Number.isInteger(attrs.start) && attrs.start > 0
            ? attrs.start
            : 1,
      };
    default:
      return imageAttributes(attrs);
  }
}
function mark(value: unknown): WritingMark {
  const m = record(value);
  if (typeof m.type === "string" && ["bold", "italic", "strike"].includes(m.type))
    return { type: m.type };
  if (m.type === "link") {
    const attrs = record(m.attrs);
    if (safeLink(attrs.href)) return { type: "link", attrs: { href: attrs.href } };
  }
  throw new Error("Unsupported formatting or unsafe link");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 100000)
    throw new Error("Invalid text");
  return value;
}
function marks(type: string, value: unknown): WritingMark[] {
  if (type !== "text" || !Array.isArray(value)) throw new Error("Invalid formatting");
  return value.map(mark);
}
function children(type: string, value: unknown): unknown[] {
  if (!Array.isArray(value) || ["text", "image", "hardBreak", "horizontalRule"].includes(type))
    throw new Error("Invalid document content");
  return value;
}
/** Normalize untrusted editor JSON once at the boundary; never trust TipTap attributes. */
export function validateDocument(value: unknown): WritingDocument {
  let count = 0;
  function visit(value: unknown, depth: number, parent?: string): WritingDocument {
    if (++count > 10000 || depth > 30) throw new Error("Invalid document");
    const node = record(value);
    const type = node.type;
    if (typeof type !== "string" || !supported(type, parent))
      throw new Error("Unsupported document structure");
    const out: WritingDocument = { type };
    const attrs = attributes(type, node.attrs);
    if (attrs) out.attrs = attrs;
    if (type === "text") out.text = text(node.text);
    if (node.marks !== undefined) out.marks = marks(type, node.marks);
    if (node.content !== undefined)
      out.content = children(type, node.content).map((child) => visit(child, depth + 1, type));
    return out;
  }
  return visit(value, 0);
}
