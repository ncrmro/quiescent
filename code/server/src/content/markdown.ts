import type { JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { emptyDocument, validateDocument, type WritingDocument } from "./document.ts";

const markdown = new MarkdownManager({ extensions: [StarterKit, Image] });
export function toMarkdown(document: WritingDocument): string {
  return markdown.serialize(validateDocument(document));
}
export function fromMarkdown(source: string): WritingDocument {
  return source ? validateDocument(markdown.parse(source)) : emptyDocument();
}

/** Discover image tokens without restricting Markdown to the visual editor schema. */
export function markdownImages(source: string): string[] {
  const result: string[] = [];
  function visit(node: JSONContent) {
    if (node.type === "image") result.push(String(node.attrs?.src));
    node.content?.forEach(visit);
  }
  visit(markdown.parse(source));
  return result;
}
