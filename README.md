# quiescent

Why: Documents should be self stable and exist outside of servers and the web, while being easy to write and edit.

The frontend for authoring new post which can operate locally and remotely on a git repository. Allowing users to write
documents that are stored in git with any media stored in git-lfs (though this is problematic itself).

Ideally these tools should be framework agnostic.

- Next.JS - Server Side Render/Static Site Generation
- Remix - Server Side Rendered

## Packages

- [server](packages/server/README.md) - Tools to store, parse and index documents
- [CLI](packages/cli/README.md) - A cli for generating new posts
- components - React Components for parsing markdown

## Getting started

Install the packages.

```bash
npm i @quiescent/server @quiescent/cli
```

Initialize the [config file](packages/server/README.md#config).

```bash
npm run qs init
```

## Document

A new `post` we can use the CLI it supports both an interactive mode and flag based runs.

```bash
npm run qs post

? What is the title of the post?
```

This would generate a file `public/posts/1903_12_17_flight.md` in the following format. At the top of each document is
an YAML header which we can use to store data about the document.

```markdown
---
title: Powered Flight Achieved description: Today is the a pair of brothers of achieved flight!
tags: news
---

Content goes here.
```

The first tag of a document is it's primary category, we index the primary category in
the [manifest](packages/server/README.md#manifest).


## Local Development

After installing dependencies the document folder will be system linked into each of the example directories.

```bash
npm run cli post
```

## Publishing 

```bash
yarn workspace @quiescent/server publish
```
