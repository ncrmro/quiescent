import { documentMediaUrl, renderDocument } from "@quiescent/server/content";
import type {
  ConfirmedUpload,
  MutationResponse,
  PostDocument as Post,
  PostDraft,
  UploadTicket,
} from "@quiescent/server/contracts";
import { createMetadataForm, type MetadataSchema } from "./metadata.ts";
import { findRecoveryRecords, type RecoveryRecord, removeRecoveredRecord } from "./recovery.ts";

type Draft = PostDraft & { branch: string };

import { createWritingEditor } from "./rich-text.ts";

export { createWritingEditor, type WritingEditorOptions } from "./rich-text.ts";
export interface WritingAppOptions {
  initialPostId?: string;
  onPostOpen?: (id: string, slug?: string | null) => void;
  apiBase?: string;
  readerBase?: string;
}
/** Reusable controller; hosts supply thin API routes and their preferred styling. */
export function mountWritingApp(root: HTMLElement, options: WritingAppOptions = {}) {
  const api = options.apiBase ?? "/api/writing";
  const reader = options.readerBase ?? "/read";
  const mediaUrl = (src: string) =>
    active ? documentMediaUrl(active.post.id, src, { apiBase: api, branch: active.branch }) : src;
  let active: Draft | undefined;
  let publishedPost: { post: Post; headSha: string } | undefined;
  const summaries = new Map<string, PostDraft>();
  let listLoaded = false;
  let editor: ReturnType<typeof createWritingEditor> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let generation = 0;
  let savedGeneration = 0;
  let publishing = false;
  let navigating = false;
  let recoveryNeedsReview = false;
  let destroyed = false;
  root.innerHTML =
    '<div class="writing-app"><aside><button type="button" data-new>New post</button><nav aria-label="Posts"></nav></aside><main><p role="status" aria-live="polite"></p><div data-fields hidden><div data-metadata></div><div data-header-tools><button type="button" data-header-upload>Add header image</button><button type="button" data-header-remove>Remove header image</button><input type="file" data-header-file accept="image/jpeg,image/png,image/webp" hidden><img data-header-preview alt="Header image preview" hidden></div><div data-editor></div><div class="writing-actions"><button type="button" data-save>Save now</button><button type="button" data-preview>Preview</button><button type="button" data-delete>Delete post</button><button type="button" data-publish>Publish</button></div><section data-preview-area hidden></section><p data-link></p></div></main></div>';
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const status = (message: string) => {
    q("[role=status]").textContent = message;
  };
  let metadata: ReturnType<typeof createMetadataForm>;
  let headerUpload: Promise<void> | undefined;
  // Freeze the outgoing editor until its saves and the incoming load complete.
  // Ignoring additional clicks prevents a slow earlier response replacing newer work.
  const navigate = async (action: () => Promise<void>) => {
    if (publishing || navigating || destroyed) return;
    await headerUpload;
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
          key: key(active.post.id, active.branch),
          raw: JSON.stringify({
            post: active.post,
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
    await headerUpload;
    if (recoveryNeedsReview)
      throw new Error("Review recovered writing and choose Save now before continuing.");
    if (saving) {
      await saving;
      return flush();
    }
    if (!active || generation === savedGeneration) return;
    const draft = active;
    const snapshot = structuredClone(draft.post);
    const version = generation;
    status("Saving…");
    saving = (async () => {
      const updated = await request<Draft>(`/posts/${draft.post.id}`, {
        method: "PUT",
        body: JSON.stringify({
          branch: draft.branch,
          expectedHeadSha: draft.headSha,
          post: snapshot,
        }),
      });
      draft.branch = updated.branch;
      draft.headSha = updated.headSha;
      draft.state = updated.state;
      updateList(updated);
      savedGeneration = version;
      if (generation === version) {
        clearRecovery();
        draft.post = updated.post;
        metadata.load(updated.post);
        showHeader();
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
    Object.assign(active.post, metadata.read());
    active.post.body = editor!.getDocument();
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
      button.textContent = `${draft.post.title || "Untitled"} — ${{ draft: "Draft", published: "Published", "unpublished-changes": "Unpublished changes" }[draft.state]}`;
      button.onclick = () => {
        void navigate(() =>
          open(draft.post.id, draft.state === "published" ? undefined : draft.branch),
        ).catch((e) => status(e.message));
      };
      nav.append(button);
    }
  };
  const updateList = (draft: PostDraft) => {
    summaries.set(draft.post.id, structuredClone(draft));
    renderList();
  };
  const list = async () => {
    const drafts = await request<PostDraft[]>("/posts");
    for (const draft of drafts)
      if (!summaries.has(draft.post.id)) summaries.set(draft.post.id, draft);
    listLoaded = true;
    renderList();
    q<HTMLButtonElement>("[data-new]").disabled = navigating;
  };
  q<HTMLButtonElement>("[data-new]").disabled = true;
  const uploadImage = async (target: string, file: File) => {
    const upload = await request<UploadTicket>(`/posts/${target}/uploads`, {
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
      await request<ConfirmedUpload>(`/posts/${target}/uploads/${upload.assetId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name }),
      })
    ).src;
  };
  const showHeader = () => {
    const image = q<HTMLImageElement>("[data-header-preview]");
    const src = active?.post.headerImage;
    image.hidden = !src;
    if (src) image.src = mediaUrl(src);
    else image.removeAttribute("src");
  };
  q("[data-header-upload]").onclick = () => {
    if (active && !publishing && !navigating && !headerUpload)
      q<HTMLInputElement>("[data-header-file]").click();
  };
  q("[data-header-remove]").onclick = () => {
    if (active && !publishing && !navigating && !headerUpload) {
      metadata.field("headerImage")!.value = "";
      changed();
      showHeader();
    }
  };
  q<HTMLInputElement>("[data-header-file]").onchange = () => {
    const input = q<HTMLInputElement>("[data-header-file]");
    const file = input.files?.[0];
    if (!file || !active || publishing || navigating || headerUpload) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      status("Choose a JPEG, PNG, or WebP image up to 10 MB.");
      input.value = "";
      return;
    }
    const id = active.post.id;
    status("Uploading header image…");
    headerUpload = uploadImage(id, file)
      .then((src) => {
        metadata.field("headerImage")!.value = src;
        changed();
        showHeader();
      })
      .catch((error) => {
        status(`Header image upload failed: ${error.message}`);
        throw error;
      })
      .finally(() => {
        headerUpload = undefined;
        input.value = "";
      });
    void headerUpload.catch(() => {});
  };
  function restoreRecovery(draft: Draft) {
    try {
      for (const candidate of findRecoveryRecords(localStorage, recoveryPrefix(draft.post.id))) {
        const when = candidate.updatedAt
          ? new Date(candidate.updatedAt).toLocaleString()
          : "an earlier session";
        if (
          !window.confirm(
            `Restore unsaved metadata and body “${candidate.post.title || "Untitled"}” from ${when} for review? Nothing will be saved until you choose Save now. Cancel keeps this copy and checks the next one.`,
          )
        )
          continue;
        draft.post = { ...draft.post, ...candidate.post };
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
      `/posts/${id}${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    );
    if (destroyed) return;
    editor?.destroy();
    active = draft;
    publishedPost = undefined;
    updateList(draft);
    generation = 0;
    savedGeneration = 0;
    let recovery = false;
    recoveryNeedsReview = false;
    metadata.disable(false);
    selectedRecovery = undefined;
    remembered = undefined;
    recovery = restoreRecovery(draft);
    metadata.load(draft.post);
    showHeader();
    q("[data-fields]").hidden = false;
    q("[data-preview-area]").hidden = true;
    q("[data-link]").replaceChildren();
    editor = createWritingEditor({
      parent: q("[data-editor]"),
      document: draft.post.body,
      onChange: changed,
      onStatus: status,
      mediaUrl,
      uploadImage: (file) => uploadImage(draft.post.id, file),
    });
    q("[data-publish]").textContent =
      draft.state === "published" || draft.post.publishedAt ? "Publish changes" : "Publish";
    options.onPostOpen?.(draft.post.id, draft.post.slug);
    status(recovery ? "Recovered unsaved writing. Review and choose Save now." : "Saved");
  };
  q("[data-new]").onclick = () => {
    void navigate(async () => {
      await editor?.waitForUploads();
      await flush();
      const draft = await request<Draft>("/posts", {
        method: "POST",
        body: "{}",
      });
      updateList(draft);
      await open(draft.post.id, draft.branch);
    }).catch((e) => status(e.message));
  };
  q("[data-save]").onclick = () => {
    if (publishing || navigating) return;
    recoveryNeedsReview = false;
    void flush().catch((e) => status(`Could not save: ${e.message}`));
  };
  q("[data-preview]").onclick = () => {
    if (!editor) return;
    const preview = q("[data-preview-area]");
    preview.innerHTML = renderDocument(editor.getDocument(), (ref) =>
      mediaUrl(ref.postId ? `/media/${ref.postId}/${ref.assetId}` : ref.assetId),
    );
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
      const result = await request<MutationResponse<{ post: Post; publishedSha: string }>>(
        `/posts/${draft.post.id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            branch: draft.branch,
            expectedHeadSha: draft.headSha,
          }),
        },
      );
      const published = await request<{ post: Post; headSha: string }>(
        `/published/${draft.post.id}`,
      );
      if (JSON.stringify(published.post) !== JSON.stringify(result.post))
        throw new Error("Publication could not yet be confirmed. Retry safely.");
      const link = document.createElement("a");
      link.href = `${reader}/${draft.post.id}/${result.post.slug ?? ""}`;
      link.textContent = "Read your post";
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
      updateList({ ...draft, post: result.post, headSha: published.headSha, state: "published" });
      publishedPost = published;
      active = undefined;
      generation = savedGeneration = 0;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit post";
      edit.onclick = () => {
        void navigate(() => open(draft.post.id)).catch((e) => status(e.message));
      };
      q("[data-link]").replaceChildren(link, edit);
      options.onPostOpen?.(result.post.id, result.post.slug);
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
    if (publishing || navigating || (!active && !publishedPost)) return;
    if (
      !window.confirm(
        "Delete this post? It will disappear from your stories. Its history remains in GitHub.",
      )
    )
      return;
    void navigate(async () => {
      await editor?.waitForUploads();
      await flush();
      const target = active ?? publishedPost!;
      const result = await request<MutationResponse<object>>(`/posts/${target.post.id}`, {
        method: "DELETE",
        body: JSON.stringify({ branch: active?.branch ?? null, expectedHeadSha: target.headSha }),
      });
      summaries.delete(target.post.id);
      renderList();
      for (const k of Object.keys(localStorage))
        if (k.startsWith(recoveryPrefix(target.post.id))) localStorage.removeItem(k);
      active = undefined;
      publishedPost = undefined;
      editor?.destroy();
      editor = undefined;
      generation = savedGeneration = 0;
      q("[data-fields]").hidden = true;
      q("[data-link]").replaceChildren();
      window.history.replaceState(null, "", "/write");
      status(result.cacheWarning ?? "Deleted");
    }).catch((e) => status(`Could not delete: ${e.message}`));
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (generation !== savedGeneration || publishing || headerUpload) {
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
          showHeader();
        },
        ["headerImage"],
      );
      if (options.initialPostId)
        await Promise.all([navigate(() => open(options.initialPostId!)), list()]);
      else {
        await list();
        status("Choose a post or start writing.");
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
