import type { EditorHost, EditorPhase, EditorState } from "./host.ts";

export type { EditorHost, EditorPhase, EditorSlots, EditorState, EditorToolbar } from "./host.ts";

import { fromMarkdown, jsonEqual, renderDocument, toMarkdown } from "@quiescent/server/content";
import type {
  ConfirmedUpload,
  DocumentDraft,
  DocumentRecord,
  MutationResponse,
  UploadTicket,
} from "@quiescent/server/contracts";
import { imageFields } from "./image-fields.ts";
import { documentUuid, localDrafts } from "./local-drafts.ts";
import { createMetadataForm, type MetadataControl, type MetadataSchema } from "./metadata.ts";
import { findRecoveryRecords, type RecoveryRecord, removeRecoveredRecord } from "./recovery.ts";

type Draft = DocumentDraft;

import { createWritingEditor } from "./rich-text.ts";

export { createWritingEditor, type WritingEditorOptions } from "./rich-text.ts";
export interface DocumentAppOptions {
  /** Arrange the mounted controls before opening a document. Keep them inside root. */
  layout?: (root: HTMLElement, host: EditorHost) => undefined | (() => void);
  configureToolbar?: import("./rich-text.ts").WritingEditorOptions["configureToolbar"];
  formatStatus?: (message: string, state: EditorState) => string;
  onState?: (state: EditorState) => void;
  mediaUrl?: import("@quiescent/server/content").DocumentMediaUrlResolver;
  deriveMetadata?: (
    current: Record<string, unknown>,
    previous: Record<string, unknown>,
  ) => Record<string, unknown>;
  initialDocumentId?: string;
  startNew?: boolean;
  onLocalDocumentOpen?: (document: DocumentRecord) => void;
  onDocumentOpen?: (document: DocumentRecord) => void;
  initialDocument: () => { frontmatter: Record<string, unknown>; body: string };
  label?: string;
  imageFields?: string[];
  fieldControls?: Record<string, MetadataControl>;
  documentPath: (document: DocumentRecord) => string;
  onDelete?: () => void;
  apiBase?: string;
}
/** Reusable controller; hosts supply thin API routes and their preferred styling. */
export function mountDocumentApp(root: HTMLElement, options: DocumentAppOptions) {
  const api = options.apiBase ?? "/api/documents";
  const local = localDrafts(api);
  const label = options.label ?? "document";
  const fields = options.imageFields ?? [];
  const mediaUrl = (src: string) => {
    if (!active) return src;
    return (
      options.mediaUrl?.({
        documentId: active.document.id,
        filename: src,
        ...(active.branch ? { branch: active.branch } : {}),
        revision: active.headSha,
      }) ??
      `${api}/${active.document.id}/media/${encodeURIComponent(src)}${active.branch ? `?branch=${encodeURIComponent(active.branch)}` : ""}`
    );
  };
  let active: Draft | undefined;
  let publishedDocument: { document: DocumentRecord; headSha: string } | undefined;
  let editor: ReturnType<typeof createWritingEditor> | undefined;
  let derivationTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let generation = 0;
  let savedGeneration = 0;
  let publishing = false;
  let navigating = false;
  let recoveryNeedsReview = false;
  let metadataValid = true;
  let localStorageFailed = false;
  let destroyed = false;
  let disposeLayout: undefined | (() => void);
  root.innerHTML =
    '<div class="writing-app"><main><p role="status" aria-live="polite"></p><div data-fields hidden><div data-metadata></div><div data-header-tools></div><div data-editor></div><div class="writing-actions"><button type="button" data-save>Save now</button><button type="button" data-preview>Preview</button><button type="button" data-delete>Delete document</button><button type="button" data-publish>Publish</button></div><section data-preview-area hidden></section><p data-link></p></div></main></div>';
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  q("[data-delete]").textContent = `Delete ${label}`;
  let markdownMode = false;
  const markdownInput = document.createElement("textarea");
  markdownInput.setAttribute("aria-label", "Markdown body");
  markdownInput.hidden = true;
  q("[data-editor]").after(markdownInput);
  markdownInput.addEventListener("input", () => changed());
  const status = (message: string, phase: EditorPhase = "notice") => {
    const state: EditorState = {
      message,
      phase,
      busy: ["saving", "publishing", "uploading"].includes(phase),
      persisted: Boolean(active && active.branch !== ""),
      publicationConfirmed: Boolean(publishedDocument && !active),
    };
    q("[role=status]").textContent = options.formatStatus?.(message, state) ?? message;
    options.onState?.(state);
  };
  let metadata: ReturnType<typeof createMetadataForm>;
  let images: ReturnType<typeof imageFields>;
  // Freeze the outgoing editor until its saves and the incoming load complete.
  // Ignoring additional clicks prevents a slow earlier response replacing newer work.
  const navigate = async (action: () => Promise<void>) => {
    if (publishing || navigating || destroyed) return;
    await images?.wait();
    if (publishing || navigating || destroyed) return;
    navigating = true;
    metadata?.disable(true);
    editor?.setEditable(false);
    try {
      await action();
    } finally {
      navigating = false;
      metadata?.disable(!active);
      editor?.setEditable(Boolean(active));
    }
  };
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const data = await response.json();
    if (!response.ok) {
      metadata?.errors(data.fields);
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "The request failed. Your writing is retained.",
      );
    }
    return data;
  };
  // getRandomValues also works on private HTTP tailnet origins.
  const recoverySession = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const recoveryPrefix = (id: string) => `quiescent-writing:${api}:${id}:`;
  const key = (id: string, branch: string | null) =>
    `${recoveryPrefix(id)}${branch}:${recoverySession}`;
  let selectedRecovery: RecoveryRecord | undefined;
  let remembered: { key: string; raw: string } | undefined;
  const remember = () => {
    if (active) {
      if (active.branch === "") {
        try {
          local.save(active.document);
          localStorageFailed = false;
        } catch {
          localStorageFailed = true;
        }
        return;
      }
      try {
        remembered = {
          key: key(active.document.id, active.branch),
          raw: JSON.stringify({
            document: active.document,
            headSha: active.headSha,
            updatedAt: Date.now(),
          }),
        };
        localStorage.setItem(remembered.key, remembered.raw);
      } catch {
        /* Server persistence remains authoritative. */
      }
    }
  };
  function clearRecovery() {
    try {
      if (remembered) removeRecoveredRecord(localStorage, remembered);
      if (selectedRecovery) removeRecoveredRecord(localStorage, selectedRecovery);
      remembered = undefined;
      selectedRecovery = undefined;
    } catch {
      /* Saved on GitHub; retain browser recovery if cleanup fails. */
    }
  }
  function needsSave(create: boolean) {
    if (!active) return false;
    return active.branch === ""
      ? create
      : generation !== savedGeneration || (active.branch === null && create);
  }
  const flush = async (create = false): Promise<void> => {
    clearTimeout(timer);
    applyDerivation();
    await images?.wait();
    if (!metadataValid)
      throw new Error("Enter valid JSON in structured metadata fields before saving.");
    if (recoveryNeedsReview)
      throw new Error("Review recovered writing and choose Save now before continuing.");
    if (saving) {
      await saving;
      return flush(create);
    }
    if (!needsSave(create)) return;
    const draft = active!;
    const snapshot = structuredClone(draft.document);
    const version = generation;
    status("Saving…", "saving");
    saving = (async () => {
      const wasLocal = draft.branch === "";
      const updated = wasLocal
        ? await request<Draft>("", { method: "POST", body: JSON.stringify(snapshot) })
        : await request<Draft>(`/${draft.document.id}`, {
            method: "PUT",
            body: JSON.stringify({
              branch: draft.branch,
              expectedHeadSha: draft.headSha,
              document: snapshot,
            }),
          });
      if (wasLocal) {
        localStorageFailed = false;
        local.remove(draft.document.id);
        options.onDocumentOpen?.(updated.document);
      }
      draft.branch = updated.branch;
      draft.headSha = updated.headSha;
      draft.state = updated.state;
      savedGeneration = version;
      if (generation === version) {
        clearRecovery();
        draft.document = updated.document;
        metadata.load(updated.document.frontmatter);
        images?.show();
        metadata.errors();
        status("Saved", "saved");
      } else remember();
    })();
    try {
      await saving;
    } finally {
      saving = undefined;
    }
    if (generation !== savedGeneration) await flush();
  };
  function scheduleAutosave(draft: Draft): boolean {
    status(
      recoveryNeedsReview
        ? "Recovered writing: choose Save now after reviewing."
        : "Unsaved changes",
      recoveryNeedsReview ? "notice" : "dirty",
    );
    if (recoveryNeedsReview || draft.branch === "") {
      if (draft.branch === "")
        status("Saved on this device — choose Save now to save to GitHub.", "local");
      return false;
    }
    return true;
  }
  function applyDerivation() {
    clearTimeout(derivationTimer);
    derivationTimer = undefined;
    if (!active || !metadataValid) return;
    const current = metadata.read();
    const derived = options.deriveMetadata?.(current, active.document.frontmatter) ?? {};
    const changes = Object.fromEntries(
      Object.entries(derived).filter(
        ([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value),
      ),
    );
    if (!Object.keys(changes).length) return;
    metadata.patch(changes);
    changed();
  }
  function metadataChanged() {
    changed();
    images?.show();
    clearTimeout(derivationTimer);
    derivationTimer = setTimeout(applyDerivation, 500);
  }
  const changed = () => {
    if (!active) return;
    try {
      const current = metadata.read();
      Object.assign(active.document.frontmatter, current);
      metadataValid = true;
    } catch {
      metadataValid = false;
      status("Enter valid JSON in structured metadata fields before saving.");
      return;
    }
    active.document.body = markdownMode ? markdownInput.value : toMarkdown(editor!.getDocument());
    generation++;
    remember();
    if (localStorageFailed) {
      status(
        "Could not save on this device. Keep this page open and choose Save now to save to GitHub.",
      );
      return;
    }
    if (!scheduleAutosave(active)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush().catch((e) => status(`Could not save: ${e.message}`));
    }, 800);
  };
  const uploadImage = async (target: string, file: File) => {
    if (!active?.branch) throw new Error("Choose Save now before uploading images.");
    const upload = await request<UploadTicket>(
      `/${target}/uploads?branch=${encodeURIComponent(active.branch)}`,
      {
        method: "POST",
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      },
    );
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });
    if (!response.ok) throw new Error("Upload failed");
    return (
      await request<ConfirmedUpload>(
        `/${target}/uploads/${upload.assetId}/confirm?branch=${encodeURIComponent(active!.branch!)}`,
        {
          method: "POST",
          body: JSON.stringify({ filename: file.name }),
        },
      )
    ).src;
  };
  function restoreRecovery(draft: Draft) {
    try {
      for (const candidate of findRecoveryRecords(
        localStorage,
        recoveryPrefix(draft.document.id),
      )) {
        const when = candidate.updatedAt
          ? new Date(candidate.updatedAt).toLocaleString()
          : "an earlier session";
        if (
          !window.confirm(
            `Restore unsaved metadata and body “${label}” from ${when} for review? Nothing will be saved until you choose Save now. Cancel keeps this copy and checks the next one.`,
          )
        )
          continue;
        draft.document = { ...draft.document, ...candidate.document };
        selectedRecovery = candidate;
        generation++;
        recoveryNeedsReview = true;
        return true;
      }
    } catch {
      /* Browser recovery is optional; saved GitHub content remains accessible. */
    }
    return false;
  }
  function loadBody(draft: Draft) {
    markdownMode = false;
    try {
      markdownMode =
        toMarkdown(fromMarkdown(draft.document.body)).trim() !== draft.document.body.trim();
    } catch {
      markdownMode = true;
    }
    markdownInput.value = draft.document.body;
    markdownInput.hidden = !markdownMode;
    q("[data-editor]").hidden = markdownMode;
    editor = markdownMode
      ? undefined
      : createWritingEditor({
          parent: q("[data-editor]"),
          ...(options.configureToolbar ? { configureToolbar: options.configureToolbar } : {}),
          document: fromMarkdown(draft.document.body),
          onChange: changed,
          onStatus: status,
          mediaUrl,
          uploadImage: (file) => uploadImage(draft.document.id, file),
        });
  }
  function opened(draft: Draft, recovery: boolean) {
    q("[data-publish]").textContent =
      draft.state === "published" || draft.document.publishedAt ? "Publish changes" : "Publish";
    if (draft.branch !== "") options.onDocumentOpen?.(draft.document);
    else options.onLocalDocumentOpen?.(draft.document);
    status(
      draft.branch === ""
        ? "Saved on this device — choose Save now to save to GitHub."
        : recovery
          ? "Recovered unsaved writing. Review and choose Save now."
          : "Saved",
      draft.branch === "" ? "local" : recovery ? "notice" : "saved",
    );
  }
  const open = async (id: string, branch?: string | null) => {
    await editor?.waitForUploads();
    await flush();
    const cached = local.list().find((draft) => draft.document.id === id);
    const draft =
      cached && cached.branch === ""
        ? (structuredClone(cached) as Draft)
        : await request<Draft>(`/${id}${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`);
    if (destroyed) return;
    editor?.destroy();
    active = draft;
    publishedDocument = undefined;
    generation = 0;
    savedGeneration = 0;
    let recovery = false;
    recoveryNeedsReview = false;
    metadata.disable(false);
    selectedRecovery = undefined;
    remembered = undefined;
    recovery = draft.branch !== "" ? restoreRecovery(draft) : false;
    metadata.load(draft.document.frontmatter);
    images?.show();
    q("[data-fields]").hidden = false;
    q("[data-preview-area]").hidden = true;
    q("[data-link]").replaceChildren();
    loadBody(draft);
    opened(draft, recovery);
  };
  const createLocal = async () => {
    await editor?.waitForUploads();
    await flush();
    const draft: Draft = {
      document: {
        ...options.initialDocument(),
        id: documentUuid(),
        createdAt: new Date().toISOString().slice(0, 10),
      },
      branch: "",
      headSha: "",
      state: "draft",
    };
    local.save(draft.document);
    await open(draft.document.id, draft.branch);
  };
  q("[data-save]").onclick = () => {
    if (publishing || navigating) return;
    recoveryNeedsReview = false;
    void flush(true).catch((e) => status(`Could not save: ${e.message}`));
  };
  q("[data-preview]").onclick = () => {
    if (!editor) {
      status("Markdown mode preserves this document verbatim; preview after publishing.");
      return;
    }
    const preview = q("[data-preview-area]");
    preview.innerHTML = renderDocument(editor.getDocument(), (ref) => mediaUrl(ref.assetId));
    preview.hidden = !preview.hidden;
  };
  function unchangedPublished() {
    return active?.branch === null && generation === savedGeneration;
  }
  async function confirmPublication(
    id: string,
    result: MutationResponse<{ document: DocumentRecord; publishedSha: string }>,
  ) {
    const published = await request<{ document: DocumentRecord; headSha: string }>(
      `/${id}/published`,
    );
    if (!jsonEqual(published.document, result.document))
      throw new Error("Publication could not yet be confirmed. Retry safely.");
    const link = document.createElement("a");
    link.href = options.documentPath(result.document);
    link.textContent = "Read document";
    link.target = "_blank";
    link.rel = "noopener";
    if (!result.cacheWarning) {
      const readerResponse = await fetch(link.href, { cache: "no-store" });
      if (
        !readerResponse.ok ||
        readerResponse.headers.get("X-Quiescent-Revision") !== published.headSha
      )
        throw new Error("The reader page has not confirmed this revision yet. Retry safely.");
    }
    return { published, link };
  }
  q("[data-publish]").onclick = () => {
    if (!active || publishing || navigating) return;
    publishing = true;
    metadata?.disable(true);
    editor?.setEditable(false);
    void (async () => {
      await editor?.waitForUploads();
      applyDerivation();
      if (unchangedPublished()) {
        status("Published", "published");
        return;
      }
      await flush(true);
      const draft = active!;
      status("Publishing…", "publishing");
      const result = await request<
        MutationResponse<{ document: DocumentRecord; publishedSha: string }>
      >(`/${draft.document.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          branch: draft.branch,
          expectedHeadSha: draft.headSha,
        }),
      });
      const { published, link } = await confirmPublication(draft.document.id, result);
      publishedDocument = published;
      active = undefined;
      generation = savedGeneration = 0;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit document";
      edit.onclick = () => {
        void navigate(() => open(draft.document.id)).catch((e) => status(e.message));
      };
      q("[data-link]").replaceChildren(link, edit);
      options.onDocumentOpen?.(result.document);
      status(result.cacheWarning ?? "Published", result.cacheWarning ? "notice" : "published");
    })()
      .catch((e) => status(`Could not publish: ${e.message}`))
      .finally(() => {
        publishing = false;
        metadata?.disable(!active);
        editor?.setEditable(Boolean(active));
      });
  };
  async function deleteTarget(target: { document: DocumentRecord; headSha: string }) {
    if (active?.branch === "") {
      local.remove(target.document.id);
      return {} as MutationResponse<object>;
    }
    return request<MutationResponse<object>>(`/${target.document.id}`, {
      method: "DELETE",
      body: JSON.stringify({ branch: active?.branch ?? null, expectedHeadSha: target.headSha }),
    });
  }
  q("[data-delete]").onclick = () => {
    if (publishing || navigating || (!active && !publishedDocument)) return;
    if (
      !window.confirm(
        "Delete this document? It will disappear from the site. Its history remains in GitHub.",
      )
    )
      return;
    void navigate(async () => {
      await editor?.waitForUploads();
      await flush();
      const target = active ?? publishedDocument!;
      const result = await deleteTarget(target);
      for (const k of Object.keys(localStorage))
        if (k.startsWith(recoveryPrefix(target.document.id))) localStorage.removeItem(k);
      active = undefined;
      publishedDocument = undefined;
      editor?.destroy();
      editor = undefined;
      generation = savedGeneration = 0;
      q("[data-fields]").hidden = true;
      q("[data-link]").replaceChildren();
      options.onDelete?.();
      status(result.cacheWarning ?? "Deleted");
    }).catch((e) => status(`Could not delete: ${e.message}`));
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (
      localStorageFailed ||
      (active && active.branch !== "" && generation !== savedGeneration) ||
      !metadataValid ||
      publishing ||
      images?.busy()
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const shortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (publishing || navigating) return;
      recoveryNeedsReview = false;
      void flush(true).catch((e) => status(`Could not save: ${e.message}`));
    }
  };
  root.addEventListener("keydown", shortcut);
  window.addEventListener("beforeunload", beforeUnload);
  void request<MetadataSchema>("/schema")
    .then(async (schema) => {
      if (destroyed) return;
      metadata = createMetadataForm(
        q("[data-metadata]"),
        schema,
        metadataChanged,
        fields,
        options.fieldControls,
      );
      images = imageFields({
        parent: q("[data-header-tools]"),
        fields,
        metadata: () => metadata,
        activeId: () => active?.document.id,
        enabled: () => Boolean(active) && !publishing && !navigating,
        upload: uploadImage,
        mediaUrl,
        changed,
        status,
      });
      q("[data-header-tools]").hidden = !fields.length;
      disposeLayout = options.layout?.(root, {
        readDocument: () => (active ? structuredClone(active.document) : undefined),
        slots: {
          status: q("[role=status]"),
          metadata: q("[data-metadata]"),
          metadataFields: metadata.slots(),
          cover: q("[data-header-tools]"),
          body: q("[data-editor]"),
          markdown: markdownInput,
          preview: q("[data-preview-area]"),
          result: q("[data-link]"),
          save: q("[data-save]") as HTMLButtonElement,
          delete: q("[data-delete]") as HTMLButtonElement,
          publish: q("[data-publish]") as HTMLButtonElement,
          showPreview: q("[data-preview]") as HTMLButtonElement,
        },
      });
      if (options.initialDocumentId) await navigate(() => open(options.initialDocumentId!));
      else if (options.startNew) await navigate(createLocal);
      else status("Choose a document or start writing.", "idle");
    })
    .catch((error) => status(`Could not load editor: ${error.message}`));
  return {
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      clearTimeout(derivationTimer);
      editor?.destroy();
      window.removeEventListener("beforeunload", beforeUnload);
      root.removeEventListener("keydown", shortcut);
      disposeLayout?.();
      root.replaceChildren();
    },
  };
}
