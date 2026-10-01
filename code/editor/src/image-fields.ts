import type { createMetadataForm } from "./metadata.ts";
export function imageFields(options: {
  parent: HTMLElement;
  fields: string[];
  metadata: () => ReturnType<typeof createMetadataForm>;
  activeId: () => string | undefined;
  enabled: () => boolean;
  upload: (id: string, file: File) => Promise<string>;
  mediaUrl: (src: string) => string;
  changed: () => void;
  status: (text: string) => void;
}) {
  let pending: Promise<void> | undefined;
  const images = new Map<string, HTMLImageElement>();
  const buttons = new Map<
    string,
    { add: HTMLButtonElement; remove: HTMLButtonElement; label: string }
  >();
  function show() {
    for (const [field, image] of images) {
      const src = options.metadata().field(field)?.value;
      image.hidden = !src;
      const controls = buttons.get(field)!;
      controls.remove.hidden = !src;
      controls.add.textContent = `${src ? "Replace" : "Add"} ${controls.label}`;
      if (src) image.src = options.mediaUrl(src);
      else image.removeAttribute("src");
    }
  }
  for (const field of options.fields) {
    const label = field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    const group = document.createElement("div");
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = `Add ${label}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = `Remove ${label}`;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.hidden = true;
    const image = document.createElement("img");
    image.alt = `${field} preview`;
    image.hidden = true;
    image.dataset.headerPreview = "";
    images.set(field, image);
    buttons.set(field, { add, remove, label });
    group.append(add, remove, input, image);
    options.parent.append(group);
    add.onclick = () => {
      if (options.enabled() && !pending) input.click();
    };
    remove.onclick = () => {
      if (!options.enabled() || pending) return;
      options.metadata().field(field)!.value = "";
      options.changed();
      show();
    };
    input.onchange = () => {
      const id = options.activeId();
      const file = input.files?.[0];
      if (!id || !file || !options.enabled() || pending) return;
      options.status("Uploading image…");
      pending = options
        .upload(id, file)
        .then((src) => {
          options.metadata().field(field)!.value = src;
          options.changed();
          show();
        })
        .catch((error: Error) => {
          options.status(`Image upload failed: ${error.message}`);
          throw error;
        })
        .finally(() => {
          pending = undefined;
          input.value = "";
        });
      void pending.catch(() => {});
    };
  }
  return { show, wait: () => pending, busy: () => Boolean(pending) };
}
