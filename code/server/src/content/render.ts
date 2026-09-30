import {
  type ImageReference,
  mediaPattern,
  type WritingDocument,
  type WritingMark,
} from "./model.ts";
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
      const match = mediaPattern.exec(String(node.attrs?.src));
      if (match) result.push({ postId: match[1]!, assetId: match[2]! });
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
  const match = mediaPattern.exec(String(attrs.src))!;
  const url = mediaUrl({ postId: match[1]!, assetId: match[2]! });
  if (!(url.startsWith("/") && !url.startsWith("//")) && !/^https?:\/\//i.test(url))
    throw new Error("Unsafe image URL");
  const title = attrs.title ? ` title="${escapeHtml(String(attrs.title))}"` : "";
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(String(attrs.alt))}"${title} loading="lazy">`;
}
/** Browser-safe and Worker-safe rendering from the validated document model. */
export function renderDocument(
  body: WritingDocument,
  mediaUrl: (reference: ImageReference) => string = (ref) => `/media/${ref.postId}/${ref.assetId}`,
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
