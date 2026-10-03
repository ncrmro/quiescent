# Changelog

## 0.1.0 (2026-10-03)


### ⚠ BREAKING CHANGES

* make document workflows collection agnostic

### Features

* **documents:** add schema-driven Markdown storage and post metadata ([5a66578](https://github.com/ncrmro/quiescent/commit/5a66578927d108382ad06b520d55487895c41b51))
* optimize document images with reusable Astro components ([4ca81a9](https://github.com/ncrmro/quiescent/commit/4ca81a93a17129dcf05aec96520aa9208ac29b6d))
* unify document caching across D1 and local SQLite ([bf2a9bd](https://github.com/ncrmro/quiescent/commit/bf2a9bd2a72ad126791a4e112c6c7af6b40b9f7f))


### Bug Fixes

* harden document caching, editor contracts and media delivery ([1ddb477](https://github.com/ncrmro/quiescent/commit/1ddb477c19cb2a9637e4e56316713070fc0efc8e))
* prepare Astro package for a future public release ([78e5ac2](https://github.com/ncrmro/quiescent/commit/78e5ac226ae5f5fb0a1ba15a9d121cdb4f31047b))
* preserve imported originals across document edits ([b3ce425](https://github.com/ncrmro/quiescent/commit/b3ce425193fbaeb8eba58239802fea27b3ad4991))


### Code Refactoring

* make document workflows collection agnostic ([6ba36b9](https://github.com/ncrmro/quiescent/commit/6ba36b9a55d17428a6e69fdcebe8e2ea86a40680))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @quiescent/server bumped from ^0.2.0 to ^0.3.0
