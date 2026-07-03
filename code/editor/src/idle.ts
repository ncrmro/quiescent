export interface IdleTrackerOptions {
  /** Milliseconds of inactivity after the last change before onIdle fires. */
  idleMs: number;
  /** Debounce for onChange notifications. */
  changeDebounceMs?: number;
  onChange?: () => void;
  onIdle?: () => void;
}

export interface IdleTracker {
  /** Call on every document change. */
  touch(): void;
  /** True if touch() was called since the last idle firing. */
  isDirty(): boolean;
  /** Cancel pending timers and mark clean (e.g. after an explicit save). */
  reset(): void;
  destroy(): void;
}

/**
 * Tracks edit activity and fires onIdle once after the user stops typing —
 * the "stop" signal that triggers a draft flush. Kept free of DOM/CodeMirror
 * so the timing behavior is unit-testable.
 */
export function createIdleTracker(options: IdleTrackerOptions): IdleTracker {
  const changeDebounceMs = options.changeDebounceMs ?? 500;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  function touch(): void {
    dirty = true;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => options.onChange?.(), changeDebounceMs);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!dirty) return;
      dirty = false;
      options.onIdle?.();
    }, options.idleMs);
  }

  function reset(): void {
    dirty = false;
    clearTimeout(idleTimer);
    clearTimeout(changeTimer);
  }

  return {
    touch,
    isDirty: () => dirty,
    reset,
    destroy: reset,
  };
}
