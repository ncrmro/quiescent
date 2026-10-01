import { fromMarkdown, renderDocument, toMarkdown } from "@quiescent/server/content";
import type {
  ConfirmedUpload,
  DocumentDraft,
  DocumentRecord,
  MutationResponse,
  UploadTicket,
} from "@quiescent/server/contracts";
import { imageFields } from "./image-fields.ts";
import { createMetadataForm, type MetadataControl, type MetadataSchema } from "./metadata.ts";
import { findRecoveryRecords, type RecoveryRecord, removeRecoveredRecord } from "./recovery.ts";

type Draft = DocumentDraft & { branch: string };

import { createWritingEditor } from "./rich-text.ts";

export { createWritingEditor, type WritingEditorOptions } from "./rich-text.ts";
export interface DocumentAppOptions {
  initialDocumentId?: string;
  onDocumentOpen?: (document: DocumentRecord) => void;
  initialDocument: () => { frontmatter: Record<string, unknown>; body: string };
  label?: string;
  displayName?: (document: DocumentRecord) => string;
  imageFields?: string[];
  fieldControls?: Record<string, MetadataControl>;
  documentPath: (document: DocumentRecord) => string;
  onDelete?: () => void;
  apiBase?: string;
}
/** Reusable controller; hosts supply thin API routes and their preferred styling. */
export function mountDocumentApp(root: HTMLElement, options: DocumentAppOptions) {
  const api = options.apiBase ?? "/api/documents";
  const label = options.label ?? "document";
  const displayName = options.displayName ?? ((value: DocumentRecord) => value.id);
  const fields = options.imageFields ?? [];
  const mediaUrl = (src: string) =>
    active
      ? `${api}/${active.document.id}/media/${encodeURIComponent(src)}?branch=${encodeURIComponent(active.branch)}`
      : src;
  let active: Draft | undefined;
  let publishedDocument: { document: DocumentRecord; headSha: string } | undefined;
  const summaries = new Map<string, DocumentDraft>();
  let listLoaded = false;
  let editor: ReturnType<typeof createWritingEditor> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let generation = 0;
  let savedGeneration = 0;
  let publishing = false;
  let navigating = false;
  let recoveryNeedsReview = false;
  let metadataValid = true;
  let destroyed = false;
  root.innerHTML =
    '<div class="writing-app"><aside><button type="button" data-new>New document</button><nav aria-label="Documents"></nav></aside><main><p role="status" aria-live="polite"></p><div data-fields hidden><div data-metadata></div><div data-header-tools></div><div data-editor></div><div class="writing-actions"><button type="button" data-save>Save now</button><button type="button" data-preview>Preview</button><button type="button" data-delete>Delete document</button><button type="button" data-publish>Publish</button></div><section data-preview-area hidden></section><p data-link></p></div></main></div>';
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  q("[data-new]").textContent = `New ${label}`;
  q("[data-delete]").textContent = `Delete ${label}`;
  q("nav").setAttribute("aria-label", `${label}s`);
  let markdownMode = false;
  const markdownInput = document.createElement("textarea");
  markdownInput.setAttribute("aria-label", "Markdown body");
  markdownInput.hidden = true;
  q("[data-editor]").after(markdownInput);
  markdownInput.addEventListener("input", () => changed());
  const status = (message: string) => {
    q("[role=status]").textContent = message;
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
    root.querySelectorAll<HTMLButtonElement>("nav button, [data-new]").forEach((button) => {
      button.disabled = true;
    });
    metadata?.disable(true);
    editor?.setEditable(false);
    try {
      await action();
    } finally {
      navigating = false;
      root.querySelectorAll<HTMLButtonElement>("nav button, [data-new]").forEach((button) => {
        button.disabled = !listLoaded;
      });
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
  const key = (id: string, branch: string) => `${recoveryPrefix(id)}${branch}:${recoverySession}`;
  let selectedRecovery: RecoveryRecord | undefined;
  let remembered: { key: string; raw: string } | undefined;
  const remember = () => {
    if (active) {
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
  const flush = async (): Promise<void> => {
    clearTimeout(timer);
    await images?.wait();
    if (!metadataValid)
      throw new Error("Enter valid JSON in structured metadata fields before saving.");
    if (recoveryNeedsReview)
      throw new Error("Review recovered writing and choose Save now before continuing.");
    if (saving) {
      await saving;
      return flush();
    }
    if (!active || generation === savedGeneration) return;
    const draft = active;
    const snapshot = structuredClone(draft.document);
    const version = generation;
    status("Saving…");
    saving = (async () => {
      const updated = await request<Draft>(`/${draft.document.id}`, {
        method: "PUT",
        body: JSON.stringify({
          branch: draft.branch,
          expectedHeadSha: draft.headSha,
          document: snapshot,
        }),
      });
      draft.branch = updated.branch;
      draft.headSha = updated.headSha;
      draft.state = updated.state;
      updateList(updated);
      savedGeneration = version;
      if (generation === version) {
        clearRecovery();
        draft.document = updated.document;
        metadata.load(updated.document.frontmatter);
        images?.show();
        metadata.errors();
        status("Saved");
      } else remember();
    })();
    try {
      await saving;
    } finally {
      saving = undefined;
    }
    if (generation !== savedGeneration) await flush();
  };
  const changed = () => {
    if (!active) return;
    try {
      Object.assign(active.document.frontmatter, metadata.read());
      metadataValid = true;
    } catch {
      metadataValid = false;
      status("Enter valid JSON in structured metadata fields before saving.");
      return;
    }
    active.document.body = markdownMode ? markdownInput.value : toMarkdown(editor!.getDocument());
    generation++;
    remember();
    status(
      recoveryNeedsReview
        ? "Recovered writing: choose Save now after reviewing."
        : "Unsaved changes",
    );
    if (recoveryNeedsReview) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush().catch((e) => status(`Could not save: ${e.message}`));
    }, 800);
  };
  const renderList = () => {
    const drafts = [...summaries.values()];
    const nav = q("nav");
    nav.replaceChildren();
    for (const draft of drafts) {
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = navigating;
      button.textContent = `${displayName(draft.document) || "Untitled"} — ${{ draft: "Draft", published: "Published", "unpublished-changes": "Unpublished changes" }[draft.state]}`;
      button.onclick = () => {
        void navigate(() =>
          open(draft.document.id, draft.state === "published" ? undefined : draft.branch),
        ).catch((e) => status(e.message));
      };
      nav.append(button);
    }
  };
  const updateList = (draft: DocumentDraft) => {
    summaries.set(draft.document.id, structuredClone(draft));
    renderList();
  };
  const list = async () => {
    const drafts = await request<DocumentDraft[]>("");
    for (const draft of drafts)
      if (!summaries.has(draft.document.id)) summaries.set(draft.document.id, draft);
    listLoaded = true;
    renderList();
    q<HTMLButtonElement>("[data-new]").disabled = navigating;
  };
  q<HTMLButtonElement>("[data-new]").disabled = true;
  const uploadImage = async (target: string, file: File) => {
    const upload = await request<UploadTicket>(`/${target}/uploads`, {
      method: "POST",
      body: JSON.stringify({ contentType: file.type, size: file.size }),
    });
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: file,
    });
    if (!response.ok) throw new Error("Upload failed");
    return (
      await request<ConfirmedUpload>(`/${target}/uploads/${upload.assetId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name }),
      })
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
            `Restore unsaved metadata and body “${"document"}” from ${when} for review? Nothing will be saved until you choose Save now. Cancel keeps this copy and checks the next one.`,
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
  const open = async (id: string, branch?: string | null) => {
    await editor?.waitForUploads();
    await flush();
    const draft = await request<Draft>(
      `/${id}${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    );
    if (destroyed) return;
    editor?.destroy();
    active = draft;
    publishedDocument = undefined;
    updateList(draft);
    generation = 0;
    savedGeneration = 0;
    let recovery = false;
    recoveryNeedsReview = false;
    metadata.disable(false);
    selectedRecovery = undefined;
    remembered = undefined;
    recovery = restoreRecovery(draft);
    metadata.load(draft.document.frontmatter);
    images?.show();
    q("[data-fields]").hidden = false;
    q("[data-preview-area]").hidden = true;
    q("[data-link]").replaceChildren();
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
          document: fromMarkdown(draft.document.body),
          onChange: changed,
          onStatus: status,
          mediaUrl,
          uploadImage: (file) => uploadImage(draft.document.id, file),
        });
    q("[data-publish]").textContent =
      draft.state === "published" || draft.document.publishedAt ? "Publish changes" : "Publish";
    options.onDocumentOpen?.(draft.document);
    status(recovery ? "Recovered unsaved writing. Review and choose Save now." : "Saved");
  };
  q("[data-new]").onclick = () => {
    void navigate(async () => {
      await editor?.waitForUploads();
      await flush();
      const draft = await request<Draft>("", {
        method: "POST",
        body: JSON.stringify(options.initialDocument()),
      });
      updateList(draft);
      await open(draft.document.id, draft.branch);
    }).catch((e) => status(e.message));
  };
  q("[data-save]").onclick = () => {
    if (publishing || navigating) return;
    recoveryNeedsReview = false;
    void flush().catch((e) => status(`Could not save: ${e.message}`));
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
  q("[data-publish]").onclick = () => {
    if (!active || publishing || navigating) return;
    publishing = true;
    metadata?.disable(true);
    editor?.setEditable(false);
    void (async () => {
      await editor?.waitForUploads();
      await flush();
      const draft = active!;
      status("Publishing…");
      const result = await request<
        MutationResponse<{ document: DocumentRecord; publishedSha: string }>
      >(`/${draft.document.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          branch: draft.branch,
          expectedHeadSha: draft.headSha,
        }),
      });
      const published = await request<{ document: DocumentRecord; headSha: string }>(
        `/${draft.document.id}/published`,
      );
      if (JSON.stringify(published.document) !== JSON.stringify(result.document))
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
      updateList({
        ...draft,
        document: result.document,
        headSha: published.headSha,
        state: "published",
      });
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
      status(result.cacheWarning ?? "Published");
    })()
      .catch((e) => status(`Could not publish: ${e.message}`))
      .finally(() => {
        publishing = false;
        metadata?.disable(!active);
        editor?.setEditable(Boolean(active));
      });
  };
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
      const result = await request<MutationResponse<object>>(`/${target.document.id}`, {
        method: "DELETE",
        body: JSON.stringify({ branch: active?.branch ?? null, expectedHeadSha: target.headSha }),
      });
      summaries.delete(target.document.id);
      renderList();
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
    if (generation !== savedGeneration || !metadataValid || publishing || images?.busy()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const shortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (publishing || navigating) return;
      recoveryNeedsReview = false;
      void flush().catch((e) => status(`Could not save: ${e.message}`));
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
        () => {
          changed();
          images?.show();
        },
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
      if (options.initialDocumentId)
        await Promise.all([navigate(() => open(options.initialDocumentId!)), list()]);
      else {
        await list();
        status("Choose a document or start writing.");
      }
    })
    .catch((error) => status(`Could not load editor: ${error.message}`));
  return {
    destroy: () => {
      destroyed = true;
      clearTimeout(timer);
      editor?.destroy();
      window.removeEventListener("beforeunload", beforeUnload);
      root.removeEventListener("keydown", shortcut);
      root.replaceChildren();
    },
  };
}
