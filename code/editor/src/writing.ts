import {
  findRecoveryRecords,
  removeRecoveredRecord,
  type RecoveryRecord,
} from "./recovery.ts";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  renderDocument,
  validateDocument,
  type WritingDocument,
} from "./document.ts";

export interface WritingEditorOptions {
  parent: HTMLElement;
  document: WritingDocument;
  onChange: (document: WritingDocument) => void;
  uploadImage: (file: File) => Promise<string>;
  onStatus?: (message: string) => void;
  mediaUrl?: (src: string) => string;
}
export function createWritingEditor(options: WritingEditorOptions) {
  const toolbar = document.createElement("div");
  toolbar.className = "writing-toolbar";
  toolbar.setAttribute("aria-label", "Formatting");
  const surface = document.createElement("div");
  options.parent.append(toolbar, surface);
  const image = Image.extend({
    renderHTML({ HTMLAttributes }) {
      return [
        "img",
        {
          ...HTMLAttributes,
          src: options.mediaUrl?.(HTMLAttributes.src) ?? HTMLAttributes.src,
        },
      ];
    },
  });
  const editor = new Editor({
    element: surface,
    content: validateDocument(options.document),
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        underline: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
      }),
      image,
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Post body",
        "aria-multiline": "true",
      },
    },
    onUpdate: () => options.onChange(editor.getJSON()),
  });
  const add = (label: string, action: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", action);
    toolbar.append(b);
    return b;
  };
  add("Bold", () => editor.chain().focus().toggleBold().run());
  add("Italic", () => editor.chain().focus().toggleItalic().run());
  add("Heading", () =>
    editor.chain().focus().toggleHeading({ level: 2 }).run(),
  );
  add("Bullets", () => editor.chain().focus().toggleBulletList().run());
  add("Numbered list", () => editor.chain().focus().toggleOrderedList().run());
  add("Quote", () => editor.chain().focus().toggleBlockquote().run());
  add("Link", () => {
    const href = window.prompt(
      "Link URL (https:// or mailto:)",
      editor.getAttributes("link").href ?? "https://",
    );
    if (href === null) return;
    if (!href) editor.chain().focus().unsetLink().run();
    else if (
      /^(https?:\/\/|mailto:)/i.test(href) &&
      !/[\u0000-\u0020]/.test(href)
    )
      editor.chain().focus().setLink({ href }).run();
    else options.onStatus?.("Enter a valid web or email link.");
  });
  add("Undo", () => editor.chain().focus().undo().run());
  add("Redo", () => editor.chain().focus().redo().run());
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp";
  file.hidden = true;
  toolbar.append(file);
  const uploads = new Set<Promise<void>>();
  let editable = true;
  let disposed = false;
  const imageButton = add("Add image", () => file.click());
  add("Image description", () => {
    if (!editor.isActive("image"))
      return options.onStatus?.("Select an image first.");
    const alt = window.prompt(
      "Describe this image",
      editor.getAttributes("image").alt ?? "",
    );
    if (alt !== null)
      editor.chain().focus().updateAttributes("image", { alt }).run();
  });
  add("Remove image", () => {
    if (editor.isActive("image"))
      editor.chain().focus().deleteSelection().run();
  });
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (!chosen || !editable || uploads.size) {
      file.value = "";
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(chosen.type) ||
      chosen.size > 10 * 1024 * 1024
    ) {
      options.onStatus?.("Choose a JPEG, PNG, or WebP image up to 10 MB.");
      file.value = "";
      return;
    }
    const alt = window.prompt("Describe this image", "") ?? "";
    imageButton.disabled = true;
    options.onStatus?.("Uploading image…");
    const upload = Promise.resolve()
      .then(() => options.uploadImage(chosen))
      .then((src) => {
        if (disposed) return;
        // Uploading is additive: a formatting selection must never be replaced.
        editor
          .chain()
          .focus()
          .setTextSelection(editor.state.selection.to)
          .setImage({ src, alt })
          .run();
        options.onStatus?.("Image uploaded.");
      })
      .catch((error) => {
        options.onStatus?.(
          `Image upload failed. Select the image again to retry. ${error.message}`,
        );
        throw error;
      })
      .finally(() => {
        uploads.delete(upload);
        file.value = "";
        imageButton.disabled = !editable || uploads.size > 0;
      });
    uploads.add(upload);
    void upload.catch(() => {});
  });
  return {
    getDocument: () => editor.getJSON(),
    setEditable: (enabled: boolean) => {
      editable = enabled;
      file.disabled = !enabled;
      editor.setEditable(enabled, false);
      toolbar.querySelectorAll("button").forEach((b) => {
        b.disabled = !enabled || (b === imageButton && uploads.size > 0);
      });
    },
    waitForUploads: async () => {
      const results = await Promise.allSettled([...uploads]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
    destroy: () => {
      disposed = true;
      editor.destroy();
      toolbar.remove();
      surface.remove();
    },
  };
}

type Post = {
  id: string;
  title: string;
  description: string;
  slug: string | null;
  body: WritingDocument;
  publishedAt?: string;
};
type Draft = {
  post: Post;
  branch: string;
  headSha: string;
  state: "draft" | "published" | "unpublished-changes";
};
export interface WritingAppOptions {
  initialPostId?: string;
  apiBase?: string;
  readerBase?: string;
}
/** Reusable controller; hosts supply thin API routes and their preferred styling. */
export function mountWritingApp(
  root: HTMLElement,
  options: WritingAppOptions = {},
) {
  const api = options.apiBase ?? "/api/writing";
  const reader = options.readerBase ?? "/read";
  let active: Draft | undefined;
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
    '<div class="writing-app"><aside><button type="button" data-new>New post</button><nav aria-label="Posts"></nav></aside><main><p role="status" aria-live="polite"></p><div data-fields hidden><label>Title<input data-title></label><label>Description<input data-description></label><div data-editor></div><div class="writing-actions"><button type="button" data-save>Save now</button><button type="button" data-preview>Preview</button><button type="button" data-publish>Publish</button></div><section data-preview-area hidden></section><p data-link></p></div></main></div>';
  const q = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const status = (message: string) => {
    q("[role=status]").textContent = message;
  };
  const title = q<HTMLInputElement>("[data-title]");
  const description = q<HTMLInputElement>("[data-description]");
  // Freeze the outgoing editor until its saves and the incoming load complete.
  // Ignoring additional clicks prevents a slow earlier response replacing newer work.
  const navigate = async (action: () => Promise<void>) => {
    if (publishing || navigating || destroyed) return;
    navigating = true;
    title.disabled = true;
    description.disabled = true;
    editor?.setEditable(false);
    try {
      await action();
    } finally {
      navigating = false;
      title.disabled = !active;
      description.disabled = !active;
      editor?.setEditable(Boolean(active));
    }
  };
  const request = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "The request failed. Your writing is retained.",
      );
    return data;
  };
  // getRandomValues also works on private HTTP tailnet origins.
  const recoverySession = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  const recoveryPrefix = (id: string) => `quiescent-writing:${api}:${id}:`;
  const key = (id: string, branch: string) =>
    `${recoveryPrefix(id)}${branch}:${recoverySession}`;
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
  const flush = async (): Promise<void> => {
    clearTimeout(timer);
    if (recoveryNeedsReview)
      throw new Error(
        "Review recovered writing and choose Save now before continuing.",
      );
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
      savedGeneration = version;
      if (generation === version) {
        try {
          if (remembered) removeRecoveredRecord(localStorage, remembered);
          if (selectedRecovery)
            removeRecoveredRecord(localStorage, selectedRecovery);
          remembered = undefined;
          selectedRecovery = undefined;
        } catch {
          /* Saved on GitHub; retain browser recovery if cleanup fails. */
        }
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
    active.post.title = title.value;
    active.post.description = description.value;
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
  title.addEventListener("input", changed);
  description.addEventListener("input", changed);
  const list = async () => {
    const drafts = await request<Draft[]>("/posts");
    const nav = q("nav");
    nav.replaceChildren();
    for (const draft of drafts) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${draft.post.title || "Untitled"} — ${{ draft: "Draft", published: "Published", "unpublished-changes": "Unpublished changes" }[draft.state]}`;
      button.onclick = () => {
        void navigate(() =>
          open(
            draft.post.id,
            draft.state === "published" ? undefined : draft.branch,
          ),
        ).catch((e) => status(e.message));
      };
      nav.append(button);
    }
  };
  const open = async (id: string, branch?: string) => {
    await editor?.waitForUploads();
    await flush();
    const draft = await request<Draft>(
      `/posts/${id}${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,
    );
    if (destroyed) return;
    editor?.destroy();
    active = draft;
    generation = 0;
    savedGeneration = 0;
    let recovery = false;
    recoveryNeedsReview = false;
    title.disabled = false;
    description.disabled = false;
    selectedRecovery = undefined;
    remembered = undefined;
    try {
      for (const candidate of findRecoveryRecords(
        localStorage,
        recoveryPrefix(id),
      )) {
        const when = candidate.updatedAt
          ? new Date(candidate.updatedAt).toLocaleString()
          : "an earlier session";
        if (
          !window.confirm(
            `Restore unsaved title and body “${candidate.post.title || "Untitled"}” from ${when} for review? Nothing will be saved until you choose Save now. Cancel keeps this copy and checks the next one.`,
          )
        )
          continue;
        draft.post = { ...draft.post, ...candidate.post };
        selectedRecovery = candidate;
        generation++;
        recovery = true;
        recoveryNeedsReview = true;
        break;
      }
    } catch {
      /* Browser recovery is optional; saved GitHub content remains accessible. */
    }
    title.value = draft.post.title;
    description.value = draft.post.description;
    q("[data-fields]").hidden = false;
    q("[data-preview-area]").hidden = true;
    q("[data-link]").replaceChildren();
    editor = createWritingEditor({
      parent: q("[data-editor]"),
      document: draft.post.body,
      onChange: changed,
      onStatus: status,
      mediaUrl: (src) => `${api}${src}`,
      uploadImage: async (file) => {
        const target = draft.post.id;
        const upload = await request<{
          assetId: string;
          url: string;
          headers: Record<string, string>;
        }>(`/posts/${target}/uploads`, {
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
          await request<{ src: string }>(
            `/posts/${target}/uploads/${upload.assetId}/confirm`,
            { method: "POST", body: "{}" },
          )
        ).src;
      },
    });
    q("[data-publish]").textContent =
      draft.state === "published" || draft.post.publishedAt
        ? "Publish changes"
        : "Publish";
    status(
      recovery
        ? "Recovered unsaved writing. Review and choose Save now."
        : "Saved",
    );
  };
  q("[data-new]").onclick = () => {
    void navigate(async () => {
      await editor?.waitForUploads();
      await flush();
      const draft = await request<Draft>("/posts", {
        method: "POST",
        body: "{}",
      });
      await list();
      await open(draft.post.id, draft.branch);
    }).catch((e) => status(e.message));
  };
  q("[data-save]").onclick = () => {
    if (publishing || navigating) return;
    recoveryNeedsReview = false;
    void flush()
      .then(list)
      .catch((e) => status(`Could not save: ${e.message}`));
  };
  q("[data-preview]").onclick = () => {
    if (!editor) return;
    const preview = q("[data-preview-area]");
    preview.innerHTML = renderDocument(
      editor.getDocument(),
      (ref) => `${api}/media/${ref.postId}/${ref.assetId}`,
    );
    preview.hidden = !preview.hidden;
  };
  q("[data-publish]").onclick = () => {
    if (!active || publishing || navigating) return;
    publishing = true;
    title.disabled = true;
    description.disabled = true;
    editor?.setEditable(false);
    void (async () => {
      await editor?.waitForUploads();
      await flush();
      const draft = active!;
      status("Publishing…");
      const result = await request<{ post: Post; publishedSha: string }>(
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
        throw new Error(
          "Publication could not yet be confirmed. Retry safely.",
        );
      const link = document.createElement("a");
      link.href = `${reader}/${draft.post.id}/${result.post.slug ?? ""}`;
      link.textContent = "Read your post";
      link.target = "_blank";
      link.rel = "noopener";
      const readerResponse = await fetch(link.href, { cache: "no-store" });
      if (
        !readerResponse.ok ||
        readerResponse.headers.get("X-Quiescent-Revision") !== published.headSha
      )
        throw new Error(
          "The reader page has not confirmed this revision yet. Retry safely.",
        );
      await list();
      active = undefined;
      generation = savedGeneration = 0;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit post";
      edit.onclick = () => {
        void navigate(() => open(draft.post.id)).catch((e) =>
          status(e.message),
        );
      };
      q("[data-link]").replaceChildren(link, edit);
      status("Published");
    })()
      .catch((e) => status(`Could not publish: ${e.message}`))
      .finally(() => {
        publishing = false;
        title.disabled = !active;
        description.disabled = !active;
        editor?.setEditable(Boolean(active));
      });
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (generation !== savedGeneration || publishing) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const shortcut = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (publishing || navigating) return;
      recoveryNeedsReview = false;
      void flush()
        .then(list)
        .catch((e) => status(`Could not save: ${e.message}`));
    }
  };
  root.addEventListener("keydown", shortcut);
  window.addEventListener("beforeunload", beforeUnload);
  void list()
    .then(() => options.initialPostId
      ? navigate(() => open(options.initialPostId!))
      : status("Choose a post or start writing."))
    .catch((e) => status(e.message));
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
