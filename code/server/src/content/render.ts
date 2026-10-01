import { isAssetFilename } from "./assets.ts";
import type { ImageReference, WritingDocument, WritingMark } from "./model.ts";
import { validateDocument } from "./validate.ts";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function imageReferences(body: WritingDocument): ImageReference[] {
  const result: ImageReference[] = [];
  function walk(node: WritingDocument) {
    if (node.type === "image") {
      if (isAssetFilename(node.attrs?.src)) result.push({ assetId: node.attrs.src });
    }
    node.content?.forEach(walk);
  }
  walk(validateDocument(body));
  return result;
}
function marked(html: string, mark: WritingMark) {
  if (mark.type === "link")
    return `<a href="${escapeHtml(String(mark.attrs?.href))}" rel="noopener noreferrer">${html}</a>`;
  const tags: Record<string, string> = { bold: "strong", italic: "em", strike: "s" };
  const tag = tags[mark.type];
  return `<${tag}>${html}</${tag}>`;
}
function image(node: WritingDocument, mediaUrl: (reference: ImageReference) => string) {
  const attrs = node.attrs!;
  const url = mediaUrl({ assetId: String(attrs.src) });
  if (
    !(url.startsWith("/") && !url.startsWith("//")) &&
    !/^https?:\/\//i.test(url) &&
    !isAssetFilename(url)
  )
    throw new Error("Unsafe image URL");
  const title = attrs.title ? ` title="${escapeHtml(String(attrs.title))}"` : "";
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(String(attrs.alt))}"${title} loading="lazy">`;
}
/** Browser-safe and Worker-safe rendering from the validated document model. */
export function renderDocument(
  body: WritingDocument,
  mediaUrl: (reference: ImageReference) => string = (ref) => ref.assetId,
): string {
  const tags: Record<string, string> = {
    paragraph: "p",
    blockquote: "blockquote",
    bulletList: "ul",
    listItem: "li",
  };
  function children(node: WritingDocument) {
    return node.content?.map(render).join("") ?? "";
  }
  function render(node: WritingDocument): string {
    if (node.type === "text") return (node.marks ?? []).reduce(marked, escapeHtml(node.text!));
    if (node.type === "image") return image(node, mediaUrl);
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "horizontalRule") return "<hr>";
    const content = children(node);
    if (node.type === "doc") return content;
    if (node.type === "heading") return `<h${node.attrs?.level}>${content}</h${node.attrs?.level}>`;
    if (node.type === "orderedList") return `<ol start="${node.attrs?.start}">${content}</ol>`;
    const tag = tags[node.type];
    return `<${tag}>${content}</${tag}>`;
  }
  return render(validateDocument(body));
}
