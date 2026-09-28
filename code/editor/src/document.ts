import type { JSONContent } from "@tiptap/core";

export type WritingDocument = JSONContent;
export type ImageReference = { postId: string; assetId: string };
const mediaPattern = /^\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;
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
export function emptyDocument(): WritingDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
function safeLink(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(https?:\/\/|mailto:)/i.test(value) &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}
/** Validate and normalize untrusted editor JSON before persistence or rendering. */
export function validateDocument(value: unknown): WritingDocument {
  let count = 0;
  const visit = (
    value: unknown,
    depth: number,
    parent?: string,
  ): JSONContent => {
    if (
      ++count > 10000 ||
      depth > 30 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error("Invalid document");
    const n = value as JSONContent;
    const type = n.type;
    if (
      !type ||
      (parent === undefined
        ? type !== "doc"
        : parent === "doc" || parent === "blockquote" || parent === "listItem"
          ? !blocks.has(type)
          : parent === "bulletList" || parent === "orderedList"
            ? type !== "listItem"
            : parent === "paragraph" || parent === "heading"
              ? !inline.has(type)
              : true)
    )
      throw new Error("Unsupported document structure");
    const out: JSONContent = { type };
    if (type === "text") {
      if (
        typeof n.text !== "string" ||
        !n.text.length ||
        n.text.length > 100000
      )
        throw new Error("Invalid text");
      out.text = n.text;
    }
    if (type === "heading") {
      const level = n.attrs?.level;
      if (![1, 2, 3].includes(level)) throw new Error("Unsupported heading");
      out.attrs = { level };
    }
    if (type === "orderedList")
      out.attrs = {
        start:
          Number.isInteger(n.attrs?.start) && n.attrs!.start > 0
            ? n.attrs!.start
            : 1,
      };
    if (type === "image") {
      if (typeof n.attrs?.src !== "string" || !mediaPattern.test(n.attrs.src))
        throw new Error("Invalid image reference");
      out.attrs = {
        src: n.attrs.src,
        alt: typeof n.attrs.alt === "string" ? n.attrs.alt.slice(0, 2000) : "",
        title:
          typeof n.attrs.title === "string"
            ? n.attrs.title.slice(0, 2000)
            : null,
      };
    }
    if (n.marks !== undefined) {
      if (type !== "text" || !Array.isArray(n.marks))
        throw new Error("Invalid formatting");
      out.marks = n.marks.map((mark) => {
        if (["bold", "italic", "strike"].includes(mark.type))
          return { type: mark.type };
        if (mark.type === "link" && safeLink(mark.attrs?.href))
          return { type: "link", attrs: { href: mark.attrs!.href } };
        throw new Error("Unsupported formatting or unsafe link");
      });
    }
    if (n.content !== undefined) {
      if (
        !Array.isArray(n.content) ||
        ["text", "image", "hardBreak", "horizontalRule"].includes(type)
      )
        throw new Error("Invalid document content");
      out.content = n.content.map((child) => visit(child, depth + 1, type));
    }
    return out;
  };
  return visit(value, 0);
}
export function imageReferences(body: WritingDocument): ImageReference[] {
  const result: ImageReference[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "image") {
      const match = mediaPattern.exec(node.attrs!.src);
      if (match) result.push({ postId: match[1]!, assetId: match[2]! });
    }
    node.content?.forEach(walk);
  };
  walk(validateDocument(body));
  return result;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** No DOM dependency: usable in a Worker and in the browser preview. */
export function renderDocument(
  body: WritingDocument,
  mediaUrl: (reference: ImageReference) => string = (ref) =>
    `/media/${ref.postId}/${ref.assetId}`,
): string {
  const render = (node: JSONContent): string => {
    const content = () => node.content?.map(render).join("") ?? "";
    switch (node.type) {
      case "doc":
        return content();
      case "text":
        return (node.marks ?? []).reduce(
          (html, mark) =>
            mark.type === "link"
              ? `<a href="${escape(mark.attrs!.href)}" rel="noopener noreferrer">${html}</a>`
              : `<${mark.type === "bold" ? "strong" : mark.type === "italic" ? "em" : "s"}>${html}</${mark.type === "bold" ? "strong" : mark.type === "italic" ? "em" : "s"}>`,
          escape(node.text!),
        );
      case "image": {
        const match = mediaPattern.exec(node.attrs!.src)!;
        const url = mediaUrl({ postId: match[1]!, assetId: match[2]! });
        if (
          !(url.startsWith("/") && !url.startsWith("//")) &&
          !/^https?:\/\//i.test(url)
        )
          throw new Error("Unsafe image URL");
        return `<img src="${escape(url)}" alt="${escape(node.attrs!.alt)}"${node.attrs!.title ? ` title="${escape(node.attrs!.title)}"` : ""} loading="lazy">`;
      }
      case "hardBreak":
        return "<br>";
      case "horizontalRule":
        return "<hr>";
      case "heading":
        return `<h${node.attrs!.level}>${content()}</h${node.attrs!.level}>`;
      case "orderedList":
        return `<ol start="${node.attrs!.start}">${content()}</ol>`;
      default: {
        const tag = (
          {
            paragraph: "p",
            blockquote: "blockquote",
            bulletList: "ul",
            listItem: "li",
          } as Record<string, string>
        )[node.type!]!;
        return `<${tag}>${content()}</${tag}>`;
      }
    }
  };
  return render(validateDocument(body));
}
