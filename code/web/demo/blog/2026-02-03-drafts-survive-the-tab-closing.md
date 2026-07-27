---
title: Drafts survive the tab closing
date: 2026-02-03
tags: [quiescent, drafts]
---

A draft is not a commit. It is a key in a `KeyValueStore` — Cloudflare KV in
production, an in-memory map in this demo — holding your text plus the blob
sha it was based on.

That indirection buys two things. Closing the tab mid-sentence leaves the
work safe, because `pagehide` fires a `sendBeacon` to the draft API. And a
cron trigger can sweep drafts that have gone quiet for five minutes and
commit them on your behalf, so an abandoned edit still lands.
