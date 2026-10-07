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
  const candidate = (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition;
  if (typeof candidate !== "function") return undefined;
  const speechRecognition = candidate as unknown as NativeRecognitionConstructor;
  if (
    typeof speechRecognition.available !== "function" ||
    typeof speechRecognition.install !== "function"
  )
    return undefined;
  try {
    if (!("processLocally" in new speechRecognition())) return undefined;
  } catch {
    return undefined;
  }
  return speechRecognition;
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
  let availability: LocalSpeechAvailability | undefined;
  let run = 0;
  let insertedThrough = 0;
  const present = (label: string, disabled = false) => {
    options.button.textContent = label;
    options.button.disabled = disabled || !enabled;
  };
  const report = (message: string) => options.onStatus?.(message);
  const detach = (instance: LocalSpeechRecognition) => {
    instance.onend = null;
    instance.onerror = null;
    instance.onresult = null;
  };
  const finish = (message?: string) => {
    recognition = undefined;
    options.interim.textContent = "";
    present("Dictate");
    if (message) report(message);
  };
  const cancel = () => {
    run++;
    const current = recognition;
    recognition = undefined;
    options.interim.textContent = "";
    if (current) {
      detach(current);
      try {
        current.abort();
      } catch {
        /* It may already have ended. */
      }
    }
    if (!disposed) present("Dictate");
  };
  const check = async () => {
    if (!provider) {
      present("Dictation unsupported", true);
      report("This browser does not support on-device dictation.");
      return;
    }
    checking = true;
    present("Checking dictation…", true);
    try {
      availability = await provider.available({ langs: [options.lang], processLocally: true });
      if (disposed) return;
      if (availability === "available") present("Dictate");
      else if (availability === "downloadable") present("Install dictation");
      else if (availability === "downloading") {
        present("Language downloading", true);
        report("The on-device language pack is still downloading.");
      } else {
        present("Dictation unavailable", true);
        report(`On-device dictation is unavailable for ${options.lang}.`);
      }
    } catch {
      if (!disposed) {
        present("Dictation unavailable", true);
        report("Could not check on-device dictation support.");
      }
    } finally {
      checking = false;
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
    }
  };
  const start = () => {
    if (!provider || recognition || disposed) return;
    const instance = provider.create();
    instance.lang = options.lang;
    instance.continuous = true;
    instance.interimResults = true;
    instance.processLocally = true;
    if (!instance.processLocally) {
      report("This browser cannot guarantee on-device dictation.");
      present("Dictation unsupported", true);
      return;
    }
    const currentRun = ++run;
    insertedThrough = 0;
    recognition = instance;
    present("Stop dictation");
    report("Listening on this device…");
    instance.onresult = (event) => {
      if (disposed || recognition !== instance || currentRun !== run) return;
      const update = collectResults(event, insertedThrough, options.insert);
      insertedThrough = update.insertedThrough;
      options.interim.textContent = update.interim;
    };
    instance.onerror = (event) => {
      if (recognition !== instance || currentRun !== run) return;
      detach(instance);
      finish(errorMessage(event.error));
    };
    instance.onend = () => {
      if (recognition !== instance || currentRun !== run) return;
      detach(instance);
      finish("Dictation ended.");
    };
    try {
      instance.start();
    } catch {
      detach(instance);
      finish("Dictation could not start.");
    }
  };
  const activate = () => {
    if (checking || installing || disposed) return;
    if (recognition) {
      const current = recognition;
      detach(current);
      try {
        current.stop();
      } catch {
        /* It may already have ended. */
      }
      finish("Dictation stopped.");
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
      options.button.disabled =
        !enabled ||
        checking ||
        installing ||
        !provider ||
        (availability !== "available" && availability !== "downloadable");
    },
    destroy() {
      disposed = true;
      cancel();
      options.button.removeEventListener("click", activate);
    },
  };
}
