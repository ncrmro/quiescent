import { safeLink, validateDocument, type WritingDocument } from "@quiescent/server/content";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
export interface WritingEditorOptions {
  parent: HTMLElement;
  /** Hosts may move command buttons within this toolbar; editor behavior is retained. */
  configureToolbar?: (toolbar: HTMLElement) => undefined | (() => void);
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
        "aria-label": "Document body",
        "aria-multiline": "true",
      },
    },
    onUpdate: () => options.onChange(validateDocument(editor.getJSON())),
  });
  const add = (label: string, action: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "format-button";
    b.textContent = label;
    b.dataset.command = label.toLowerCase().replaceAll(" ", "-");
    b.setAttribute("aria-label", label);
    // Keep the editing selection and keyboard when tapping a formatting action.
    b.addEventListener("pointerdown", (event) => event.preventDefault());
    b.addEventListener("click", action);
    toolbar.append(b);
    return b;
  };
  add("Bold", () => editor.chain().focus().toggleBold().run());
  add("Italic", () => editor.chain().focus().toggleItalic().run());
  add("Heading", () => editor.chain().focus().toggleHeading({ level: 2 }).run());
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
    else if (safeLink(href)) editor.chain().focus().setLink({ href }).run();
    else options.onStatus?.("Enter a valid web or email link.");
  });
  add("Undo", () => editor.chain().focus().undo().run());
  add("Redo", () => editor.chain().focus().redo().run());
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp,image/gif";
  file.hidden = true;
  toolbar.append(file);
  const uploads = new Set<Promise<void>>();
  let editable = true;
  let disposed = false;
  const imageButton = add("Add image", () => file.click());
  const descriptionButton = add("Image description", () => {
    if (!editor.isActive("image")) return options.onStatus?.("Select an image first.");
    const alt = window.prompt("Describe this image", editor.getAttributes("image").alt ?? "");
    if (alt !== null) editor.chain().focus().updateAttributes("image", { alt }).run();
  });
  const removeButton = add("Remove image", () => {
    if (editor.isActive("image")) editor.chain().focus().deleteSelection().run();
  });
  const showImageActions = () => {
    descriptionButton.hidden = !editor.isActive("image");
    removeButton.hidden = !editor.isActive("image");
  };
  editor.on("selectionUpdate", showImageActions);
  editor.on("update", showImageActions);
  showImageActions();
  const disposeToolbar = options.configureToolbar?.(toolbar);
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    if (!chosen || !editable || uploads.size) {
      file.value = "";
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(chosen.type) ||
      chosen.size > 10 * 1024 * 1024
    ) {
      options.onStatus?.("Choose a JPEG, PNG, WebP, or GIF image up to 10 MB.");
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
    getDocument: () => validateDocument(editor.getJSON()),
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
      disposeToolbar?.();
      editor.destroy();
      toolbar.remove();
      surface.remove();
    },
  };
}
