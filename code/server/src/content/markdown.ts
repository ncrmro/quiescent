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
