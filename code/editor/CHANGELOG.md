# Changelog

## [0.3.0](https://github.com/ncrmro/quiescent/compare/quiescent-editor-v0.2.0...quiescent-editor-v0.3.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* make document workflows collection agnostic

### Features

* add GitHub-backed writing and publication workflow ([979df60](https://github.com/ncrmro/quiescent/commit/979df604684dc9c6f477568302189a7481c09d02))
* derive document slugs and add mobile navigation ([ebcecfa](https://github.com/ncrmro/quiescent/commit/ebcecfa8781fb03a760a7f929d721866ea10177d))
* **documents:** add schema-driven Markdown storage and post metadata ([5a66578](https://github.com/ncrmro/quiescent/commit/5a66578927d108382ad06b520d55487895c41b51))
* let signed-in readers edit stories directly ([13389fd](https://github.com/ncrmro/quiescent/commit/13389fd018161672664a9f05138e6f6e90c04125))
* store document-relative images in Git LFS with portable delivery ([6c4790a](https://github.com/ncrmro/quiescent/commit/6c4790aec6dd7c80ca4ff53fd524c1159c5d061b))
* streamline mobile document editing and publishing ([f40f8b0](https://github.com/ncrmro/quiescent/commit/f40f8b0748ff94fb7dad6b60c15bfcf936f6179e))
* unify document caching across D1 and local SQLite ([bf2a9bd](https://github.com/ncrmro/quiescent/commit/bf2a9bd2a72ad126791a4e112c6c7af6b40b9f7f))
* use dedicated new and UUID editor routes ([75b4ee3](https://github.com/ncrmro/quiescent/commit/75b4ee305ecc9d2bcd0f9234203ca84f5ba63a8c))


### Bug Fixes

* debounce slug generation only when empty ([368cec6](https://github.com/ncrmro/quiescent/commit/368cec65eae67fd40447f4b9570cbd20ced65510))
* harden document caching, editor contracts and media delivery ([1ddb477](https://github.com/ncrmro/quiescent/commit/1ddb477c19cb2a9637e4e56316713070fc0efc8e))
* keep new documents local until their first save ([ff02916](https://github.com/ncrmro/quiescent/commit/ff02916233e2e7435afb4b08b1b2c635071f65c0))
* preserve imported originals across document edits ([b3ce425](https://github.com/ncrmro/quiescent/commit/b3ce425193fbaeb8eba58239802fea27b3ad4991))
* support private tailnet writing previews on mobile ([6f54419](https://github.com/ncrmro/quiescent/commit/6f54419e36cb1c7f32a35b62bb5b82d467ea27cb))


### Code Refactoring

* make document workflows collection agnostic ([6ba36b9](https://github.com/ncrmro/quiescent/commit/6ba36b9a55d17428a6e69fdcebe8e2ea86a40680))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @quiescent/server bumped from ^0.2.0 to ^0.3.0

## [0.2.0](https://github.com/ncrmro/quiescent/compare/quiescent-editor-v0.1.0...quiescent-editor-v0.2.0) (2026-07-05)


### ⚠ BREAKING CHANGES

* publish under the @quiescent npm org; storage-agnostic server

### Features

* **editor:** CodeMirror 6 markdown editor with idle detection ([6c81dbf](https://github.com/ncrmro/quiescent/commit/6c81dbfc7ef3e403c9671df1eeb71a5d05e8eafa))
* publish under the [@quiescent](https://github.com/quiescent) npm org; storage-agnostic server ([e0ddf8e](https://github.com/ncrmro/quiescent/commit/e0ddf8e0d8efd90f0495cced5bdd05f721909f26))
