import type { DocumentRecord } from "@quiescent/server/contracts";

export type EditorPhase =
  | "idle"
  | "local"
  | "dirty"
  | "saving"
  | "saved"
  | "publishing"
  | "published"
  | "uploading"
  | "notice";
export interface EditorState {
  phase: EditorPhase;
  message: string;
  busy: boolean;
  persisted: boolean;
  publicationConfirmed: boolean;
}
/** Stable DOM handles. Hosts may move these nodes without replacing their handlers. */
export interface EditorSlots {
  status: HTMLElement;
  metadata: HTMLElement;
  metadataFields: ReadonlyMap<string, { container: HTMLElement; input: HTMLElement }>;
  cover: HTMLElement;
  body: HTMLElement;
  markdown: HTMLTextAreaElement;
  preview: HTMLElement;
  result: HTMLElement;
  save: HTMLButtonElement;
  delete: HTMLButtonElement;
  publish: HTMLButtonElement;
  showPreview: HTMLButtonElement;
}
export interface EditorHost {
  slots: EditorSlots;
  readDocument(): DocumentRecord | undefined;
}
/** The editable surface and command handles do not expose TipTap implementation classes. */
export interface EditorToolbar {
  editable: HTMLElement;
  commands: ReadonlyMap<string, HTMLButtonElement>;
}
