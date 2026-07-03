import { marked } from "marked";

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}

export interface Preview {
  update(source: string): void;
}

export function createPreview(parent: HTMLElement): Preview {
  return {
    update(source: string) {
      parent.innerHTML = renderMarkdown(source);
    },
  };
}
