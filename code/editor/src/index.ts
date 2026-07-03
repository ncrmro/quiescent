import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { createIdleTracker, type IdleTracker } from "./idle.ts";

export { createIdleTracker, type IdleTracker, type IdleTrackerOptions } from "./idle.ts";
export { renderMarkdown, createPreview, type Preview } from "./preview.ts";

export interface EditorOptions {
  parent: HTMLElement;
  doc?: string;
  /** Inactivity window before onIdle fires; defaults to 30s. */
  idleMs?: number;
  /** Debounced (500ms) notification with the current document. */
  onChange?: (doc: string) => void;
  /** Fired once after the user stops typing — the flush-on-stop signal. */
  onIdle?: (doc: string) => void;
  /** Ctrl/Cmd+S. */
  onSave?: (doc: string) => void;
}

export interface QuiescentEditor {
  view: EditorView;
  getDoc(): string;
  /** True if there are changes since the last idle flush / markClean. */
  isDirty(): boolean;
  /** Mark the current state as persisted (after a successful flush). */
  markClean(): void;
  destroy(): void;
}

export function createEditor(options: EditorOptions): QuiescentEditor {
  let view: EditorView;
  const tracker: IdleTracker = createIdleTracker({
    idleMs: options.idleMs ?? 30_000,
    onChange: () => options.onChange?.(view.state.doc.toString()),
    onIdle: () => options.onIdle?.(view.state.doc.toString()),
  });

  const state = EditorState.create({
    doc: options.doc ?? "",
    extensions: [
      lineNumbers(),
      history(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: "Mod-s",
          run: (v) => {
            tracker.reset();
            options.onSave?.(v.state.doc.toString());
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) tracker.touch();
      }),
    ],
  });

  view = new EditorView({ state, parent: options.parent });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    isDirty: () => tracker.isDirty(),
    markClean: () => tracker.reset(),
    destroy: () => {
      tracker.destroy();
      view.destroy();
    },
  };
}
