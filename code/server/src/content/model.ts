export interface WritingMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface WritingDocument {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: WritingMark[];
  content?: WritingDocument[];
}
export interface ImageReference {
  postId: string;
  assetId: string;
}
export const mediaPattern = /^\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;
export function emptyDocument(): WritingDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid document");
  return value as Record<string, unknown>;
}
export function safeLink(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(https?:\/\/|mailto:)/i.test(value) &&
    ![...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
  );
}
