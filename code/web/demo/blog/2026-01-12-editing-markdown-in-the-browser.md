---
title: Editing markdown in the browser
date: 2026-01-12
tags: [quiescent, editing]
---

The editor you are looking at is CodeMirror 6 wired up by `@quiescent/editor`.
It watches for you to stop typing, and *that* is the signal to persist.

Three things happen as you work:

1. Every keystroke updates the preview on the right.
2. A debounced save posts the document to the draft API.
3. Thirty seconds of quiet — or Ctrl/Cmd+S — flushes the draft to a commit.

Nothing here is a special demo code path: the same packages a real deployment
installs are doing the work, against a stubbed forge.
