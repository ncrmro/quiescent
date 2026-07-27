---
title: Two ways to land an edit
date: 2026-02-20
tags: [quiescent, git]
---

Whether an edit becomes a commit or a pull request is decided by one flag on
the user.

With push access, drafts flush straight onto the default branch — notes mode,
for a wiki you own. Without it, quiescent cuts a branch, and if even that is
refused, forks the repo and opens a cross-repo pull request. That is the
"suggest an edit" flow for open-source docs.

Both paths go through the same forge HTTP API abstraction, so neither needs a
git binary or a checkout on the server.
