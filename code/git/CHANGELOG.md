# Changelog

## [0.3.0](https://github.com/ncrmro/quiescent/compare/quiescent-git-v0.2.0...quiescent-git-v0.3.0) (2026-10-03)


### Features

* add GitHub-backed writing and publication workflow ([979df60](https://github.com/ncrmro/quiescent/commit/979df604684dc9c6f477568302189a7481c09d02))
* cache document listings and batch GitHub rebuilds ([b01e030](https://github.com/ncrmro/quiescent/commit/b01e0303f978c8326b04dc94500126688013f9b4))
* **documents:** add schema-driven Markdown storage and post metadata ([5a66578](https://github.com/ncrmro/quiescent/commit/5a66578927d108382ad06b520d55487895c41b51))
* **git:** author/committer overrides on commitFiles ([fb727c1](https://github.com/ncrmro/quiescent/commit/fb727c109f66e1e40bb8da9c6a36999e94271f5b))
* store document-relative images in Git LFS with portable delivery ([6c4790a](https://github.com/ncrmro/quiescent/commit/6c4790aec6dd7c80ca4ff53fd524c1159c5d061b))


### Bug Fixes

* harden document caching, editor contracts and media delivery ([1ddb477](https://github.com/ncrmro/quiescent/commit/1ddb477c19cb2a9637e4e56316713070fc0efc8e))


### Performance Improvements

* batch document listing reads and keep media reads read-only ([6ea629c](https://github.com/ncrmro/quiescent/commit/6ea629c6e4f5f97debf19a756fa5126a54dc78c8))

## [0.2.0](https://github.com/ncrmro/quiescent/compare/quiescent-git-v0.1.0...quiescent-git-v0.2.0) (2026-07-05)


### ⚠ BREAKING CHANGES

* publish under the @quiescent npm org; storage-agnostic server

### Features

* **git:** forge API abstraction for GitHub, Gitea, Forgejo, and Codeberg ([8270916](https://github.com/ncrmro/quiescent/commit/8270916299665ec71e8fb79d918bade5b34d21be))
* publish under the [@quiescent](https://github.com/quiescent) npm org; storage-agnostic server ([e0ddf8e](https://github.com/ncrmro/quiescent/commit/e0ddf8e0d8efd90f0495cced5bdd05f721909f26))
