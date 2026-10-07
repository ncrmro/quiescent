export type LocalSpeechAvailability = "available" | "downloadable" | "downloading" | "unavailable";

export interface LocalSpeechResult {
  transcript: string;
  final: boolean;
}

export interface LocalSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally: boolean;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: { resultIndex: number; results: ArrayLike<LocalSpeechResult> }) => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface LocalSpeechProvider {
  available(options: { langs: string[]; processLocally: true }): Promise<LocalSpeechAvailability>;
  install(options: { langs: string[] }): Promise<boolean>;
  create(): LocalSpeechRecognition;
}

interface NativeResult extends ArrayLike<{ transcript?: string }> {
  isFinal?: boolean;
}
interface NativeRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<NativeResult> }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface NativeRecognitionConstructor {
  new (): NativeRecognition;
  available(options: { langs: string[]; processLocally: true }): Promise<LocalSpeechAvailability>;
  install(options: { langs: string[] }): Promise<boolean>;
}

function nativeConstructor(): NativeRecognitionConstructor | undefined {
  try {
    const candidate = (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition;
    if (typeof candidate !== "function") return undefined;
    const speechRecognition = candidate as unknown as NativeRecognitionConstructor;
    if (
      typeof speechRecognition.available !== "function" ||
      typeof speechRecognition.install !== "function"
    )
      return undefined;
    if (!("processLocally" in new speechRecognition())) return undefined;
    return speechRecognition;
  } catch {
    return undefined;
  }
}

/** Returns only an unprefixed implementation with the mandatory on-device API. */
export function browserLocalSpeechProvider(): LocalSpeechProvider | undefined {
  const speechRecognition = nativeConstructor();
  if (!speechRecognition) return undefined;
  return {
    available: (options) => speechRecognition.available(options),
    install: (options) => speechRecognition.install(options),
    create: () => {
      const native = new speechRecognition();
      const recognition: LocalSpeechRecognition = {
        get continuous() {
          return native.continuous;
        },
        set continuous(value) {
          native.continuous = value;
        },
        get interimResults() {
          return native.interimResults;
        },
        set interimResults(value) {
          native.interimResults = value;
        },
        get lang() {
          return native.lang;
        },
        set lang(value) {
          native.lang = value;
        },
        get processLocally() {
          return native.processLocally === true;
        },
        set processLocally(value) {
          native.processLocally = value;
        },
        onend: null,
        onerror: null,
        onresult: null,
        start: () => native.start(),
        stop: () => native.stop(),
        abort: () => native.abort(),
      };
      native.onend = () => recognition.onend?.();
      native.onerror = (event) => recognition.onerror?.(event);
      native.onresult = (event) => {
        const results = Array.from(event.results, (result) => ({
          transcript: result[0]?.transcript ?? "",
          final: result.isFinal === true,
        }));
        recognition.onresult?.({ resultIndex: event.resultIndex ?? 0, results });
      };
      return recognition;
    },
  };
}

export interface LocalDictationOptions {
  /** BCP 47 language tag whose on-device pack is required. */
  lang: string;
  /** Test or embedded-browser override. Native browser support is used by default. */
  provider?: LocalSpeechProvider;
}
export interface LocalDictationControllerOptions extends LocalDictationOptions {
  button: HTMLButtonElement;
  interim: HTMLElement;
  insert: (text: string) => void;
  onStart?: () => void;
  onStatus?: (message: string) => void;
}

const errorMessage = (error: string | undefined) => {
  if (error === "not-allowed" || error === "service-not-allowed")
    return "Microphone permission was denied. Dictation did not start.";
  if (error === "language-not-supported") return "The on-device language pack is not installed.";
  if (error === "audio-capture") return "No microphone is available.";
  return `Dictation stopped${error ? `: ${error}` : "."}`;
};

function collectResults(
  event: { resultIndex: number; results: ArrayLike<LocalSpeechResult> },
  insertedThrough: number,
  insert: (text: string) => void,
) {
  const interim: string[] = [];
  let nextInsertedThrough = insertedThrough;
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index];
    if (!result) continue;
    if (result.final) {
      if (index >= nextInsertedThrough) insert(result.transcript);
      nextInsertedThrough = Math.max(nextInsertedThrough, index + 1);
    } else if (index >= nextInsertedThrough) interim.push(result.transcript);
  }
  return { insertedThrough: nextInsertedThrough, interim: interim.join(" ") };
}

export function createLocalDictation(options: LocalDictationControllerOptions) {
  const provider = options.provider ?? browserLocalSpeechProvider();
  let recognition: LocalSpeechRecognition | undefined;
  let disposed = false;
  let checking = false;
  let installing = false;
  let enabled = true;
  let stopping = false;
  let availability: LocalSpeechAvailability | undefined;
  let run = 0;
  let insertedThrough = 0;
  const present = (label: string, disabled = false) => {
    options.button.textContent = label;
    options.button.setAttribute("aria-label", label);
    options.button.disabled = disabled || !enabled;
  };
  const report = (message: string) => {
    options.interim.textContent = message;
    options.onStatus?.(message);
  };
  const render = () => {
    if (stopping) return present("Stopping dictation…", true);
    if (recognition) return present("Stop dictation");
    if (installing) return present("Installing dictation…", true);
    if (checking) return present("Checking dictation…", true);
    if (!provider) return present("Dictation unsupported", true);
    const labels: Record<LocalSpeechAvailability, string> = {
      available: "Dictate",
      downloadable: "Install dictation",
      downloading: "Language downloading",
      unavailable: "Dictation unavailable",
    };
    present(
      labels[availability ?? "unavailable"],
      availability !== "available" && availability !== "downloadable",
    );
  };
  const detach = (instance: LocalSpeechRecognition) => {
    try {
      instance.onend = null;
      instance.onerror = null;
      instance.onresult = null;
    } catch {
      // Session identity guards still reject callbacks if provider cleanup fails.
    }
  };
  const finish = (message?: string) => {
    recognition = undefined;
    stopping = false;
    options.interim.textContent = "";
    render();
    if (message) report(message);
  };
  const cancel = () => {
    run++;
    const current = recognition;
    recognition = undefined;
    stopping = false;
    options.interim.textContent = "";
    if (current) {
      detach(current);
      try {
        current.abort();
      } catch {
        /* It may already have ended. */
      }
    }
    if (!disposed) render();
  };
  const check = async () => {
    if (!provider) {
      present("Dictation unsupported", true);
      options.interim.textContent = "This browser does not support on-device dictation.";
      return;
    }
    checking = true;
    present("Checking dictation…", true);
    try {
      availability = await provider.available({ langs: [options.lang], processLocally: true });
      if (disposed) return;
      const messages: Record<LocalSpeechAvailability, string> = {
        available: "",
        downloadable: `Install the on-device language pack for ${options.lang} to dictate.`,
        downloading: "The on-device language pack is still downloading.",
        unavailable: `On-device dictation is unavailable for ${options.lang}.`,
      };
      options.interim.textContent = messages[availability];
    } catch {
      if (!disposed) {
        availability = "unavailable";
        options.interim.textContent = "Could not check on-device dictation support.";
      }
    } finally {
      checking = false;
      if (!disposed) render();
    }
  };
  const install = async () => {
    if (!provider || installing) return;
    installing = true;
    present("Installing dictation…", true);
    try {
      const installed = await provider.install({ langs: [options.lang] });
      if (disposed) return;
      if (!installed) {
        present("Install dictation");
        report("The on-device language pack was not installed.");
        return;
      }
      await check();
    } catch {
      if (!disposed) {
        present("Install dictation");
        report("Could not install the on-device language pack.");
      }
    } finally {
      installing = false;
      if (!disposed) render();
    }
  };
  const start = () => {
    if (!provider || recognition || disposed || !enabled) return;
    let instance: LocalSpeechRecognition;
    try {
      instance = provider.create();
      recognition = instance;
      instance.lang = options.lang;
      instance.continuous = true;
      instance.interimResults = true;
      instance.processLocally = true;
      if (!instance.processLocally) throw new Error("Local recognition unavailable");
      options.onStart?.();
    } catch {
      cancel();
      report("Dictation could not start on this device.");
      return;
    }
    const currentRun = ++run;
    insertedThrough = 0;
    recognition = instance;
    present("Stop dictation");
    report("Listening on this device…");
    try {
      instance.onresult = (event) => {
        if (disposed || recognition !== instance || currentRun !== run) return;
        const update = collectResults(event, insertedThrough, options.insert);
        insertedThrough = update.insertedThrough;
        options.interim.textContent = update.interim;
      };
      instance.onerror = (event) => {
        if (recognition !== instance || currentRun !== run) return;
        cancel();
        report(errorMessage(event.error));
      };
      instance.onend = () => {
        if (recognition !== instance || currentRun !== run) return;
        detach(instance);
        finish("Dictation ended.");
      };
      instance.start();
    } catch {
      cancel();
      report("Dictation could not start.");
    }
  };
  const activate = () => {
    if (checking || installing || disposed || !enabled || stopping) return;
    if (recognition) {
      const current = recognition;
      stopping = true;
      render();
      try {
        current.stop();
      } catch {
        cancel();
        report("Dictation could not stop normally.");
      }
    } else if (availability === "downloadable") void install();
    else if (availability === "available") start();
    else void check();
  };
  options.button.addEventListener("click", activate);
  void check();
  return {
    cancel,
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) cancel();
      render();
    },
    destroy() {
      disposed = true;
      cancel();
      options.button.removeEventListener("click", activate);
    },
  };
}
