import { afterEach, describe, expect, test } from "bun:test";
import {
  browserLocalSpeechProvider,
  createLocalDictation,
  type LocalSpeechAvailability,
  type LocalSpeechProvider,
  type LocalSpeechRecognition,
  type LocalSpeechResult,
} from "../src/local-dictation.ts";

class Button extends EventTarget {
  textContent = "";
  disabled = false;
  click() {
    if (!this.disabled) this.dispatchEvent(new Event("click"));
  }
}

class Recognition implements LocalSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  processLocally = false;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onresult:
    | ((event: { resultIndex: number; results: ArrayLike<LocalSpeechResult> }) => void)
    | null = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  start() {
    this.starts++;
  }
  stop() {
    this.stops++;
  }
  abort() {
    this.aborts++;
  }
  results(resultIndex: number, results: LocalSpeechResult[]) {
    this.onresult?.({ resultIndex, results });
  }
}

const originalRecognition = Object.getOwnPropertyDescriptor(globalThis, "SpeechRecognition");
const originalPrefixed = Object.getOwnPropertyDescriptor(globalThis, "webkitSpeechRecognition");
afterEach(() => {
  if (originalRecognition)
    Object.defineProperty(globalThis, "SpeechRecognition", originalRecognition);
  else Reflect.deleteProperty(globalThis, "SpeechRecognition");
  if (originalPrefixed)
    Object.defineProperty(globalThis, "webkitSpeechRecognition", originalPrefixed);
  else Reflect.deleteProperty(globalThis, "webkitSpeechRecognition");
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const elements = () => ({
  button: new Button() as unknown as HTMLButtonElement,
  interim: { textContent: "" } as HTMLElement,
});

describe("browser local speech capability", () => {
  test("rejects prefixed and incomplete recognition APIs", () => {
    Reflect.deleteProperty(globalThis, "SpeechRecognition");
    Object.defineProperty(globalThis, "webkitSpeechRecognition", { value: class {} });
    expect(browserLocalSpeechProvider()).toBeUndefined();
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      value: class {
        processLocally = false;
      },
    });
    expect(browserLocalSpeechProvider()).toBeUndefined();
  });

  test("requires processLocally and forwards the strict availability query", async () => {
    let query: unknown;
    class Native {
      static available(options: unknown) {
        query = options;
        return Promise.resolve("available");
      }
      static install() {
        return Promise.resolve(true);
      }
      processLocally = false;
      continuous = false;
      interimResults = false;
      lang = "";
      onend = null;
      onerror = null;
      onresult = null;
      start() {}
      stop() {}
      abort() {}
    }
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      value: Native,
    });
    const provider = browserLocalSpeechProvider();
    expect(provider).toBeDefined();
    await provider!.available({ langs: ["en-US"], processLocally: true });
    expect(query).toEqual({ langs: ["en-US"], processLocally: true });
    const recognition = provider!.create();
    recognition.processLocally = true;
    expect(recognition.processLocally).toBe(true);
  });
});

describe("local dictation lifecycle", () => {
  test("makes language installation a separate user action", async () => {
    const recognition = new Recognition();
    const queries: unknown[] = [];
    let availability: LocalSpeechAvailability = "downloadable";
    let installs = 0;
    const provider: LocalSpeechProvider = {
      available: async (options) => {
        queries.push(options);
        return availability;
      },
      install: async (options) => {
        expect(options).toEqual({ langs: ["en-US"] });
        installs++;
        availability = "available";
        return true;
      },
      create: () => recognition,
    };
    const { button, interim } = elements();
    const controller = createLocalDictation({
      button,
      interim,
      lang: "en-US",
      provider,
      insert: () => {},
    });
    await settle();
    expect(button.textContent).toBe("Install dictation");
    expect(recognition.starts).toBe(0);
    button.click();
    await settle();
    expect(installs).toBe(1);
    expect(queries).toEqual([
      { langs: ["en-US"], processLocally: true },
      { langs: ["en-US"], processLocally: true },
    ]);
    expect(button.textContent).toBe("Dictate");
    button.click();
    expect(recognition.starts).toBe(1);
    expect(recognition.processLocally).toBe(true);
    controller.destroy();
  });

  test("shows interim text, inserts each final once, and ignores results after cancellation", async () => {
    const recognition = new Recognition();
    const inserted: string[] = [];
    const provider: LocalSpeechProvider = {
      available: async () => "available",
      install: async () => true,
      create: () => recognition,
    };
    const { button, interim } = elements();
    const controller = createLocalDictation({
      button,
      interim,
      lang: "en-US",
      provider,
      insert: (text) => inserted.push(text),
    });
    await settle();
    button.click();
    recognition.results(0, [{ transcript: "draft", final: false }]);
    expect(interim.textContent).toBe("draft");
    recognition.results(0, [{ transcript: "final <b>plain</b>", final: true }]);
    recognition.results(0, [{ transcript: "final <b>plain</b>", final: true }]);
    recognition.results(1, [
      { transcript: "final <b>plain</b>", final: true },
      { transcript: " next", final: true },
    ]);
    expect(inserted).toEqual(["final <b>plain</b>", " next"]);
    controller.cancel();
    expect(recognition.aborts).toBe(1);
    recognition.results(2, [{ transcript: " late", final: true }]);
    expect(inserted).toHaveLength(2);
    expect(interim.textContent).toBe("");
  });

  test("reports permission errors and tears down active recognition", async () => {
    const recognition = new Recognition();
    const statuses: string[] = [];
    const { button, interim } = elements();
    const controller = createLocalDictation({
      button,
      interim,
      lang: "en-US",
      provider: {
        available: async () => "available",
        install: async () => true,
        create: () => recognition,
      },
      insert: () => {},
      onStatus: (status) => statuses.push(status),
    });
    await settle();
    button.click();
    recognition.onerror?.({ error: "not-allowed" });
    expect(statuses.at(-1)).toContain("permission was denied");
    expect(button.textContent).toBe("Dictate");
    button.click();
    controller.destroy();
    expect(recognition.aborts).toBe(1);
    recognition.onend?.();
    expect(statuses.at(-1)).toBe("Listening on this device…");
  });
});
