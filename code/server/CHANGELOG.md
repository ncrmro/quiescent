# Changelog

## [0.3.0](https://github.com/ncrmro/quiescent/compare/quiescent-server-v0.2.0...quiescent-server-v0.3.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* **server:** remove legacy draft APIs
* make document workflows collection agnostic
* **server:** Draft now carries a WikiUser snapshot (string ids) instead of userId:number+sessionId, flushDrafts takes {user, tokenSource, sessionId?}, and Env's SESSIONS/OAUTH_*/SESSION_SECRET are optional (service-token mode needs none of them). Also fixes @quiescent/git resolving from the registry instead of the workspace.

### Features

* add GitHub-backed writing and publication workflow ([979df60](https://github.com/ncrmro/quiescent/commit/979df604684dc9c6f477568302189a7481c09d02))
* cache document listings and batch GitHub rebuilds ([b01e030](https://github.com/ncrmro/quiescent/commit/b01e0303f978c8326b04dc94500126688013f9b4))
* configure document collections with inline JSON schemas ([a732ab0](https://github.com/ncrmro/quiescent/commit/a732ab0f0f7cc29c964fe0d165a96d2f2c9dbff0))
* **documents:** add schema-driven Markdown storage and post metadata ([5a66578](https://github.com/ncrmro/quiescent/commit/5a66578927d108382ad06b520d55487895c41b51))
* let signed-in readers edit stories directly ([13389fd](https://github.com/ncrmro/quiescent/commit/13389fd018161672664a9f05138e6f6e90c04125))
* **server:** pluggable AuthAdapter and TokenSource for host-app auth ([3ef99bb](https://github.com/ncrmro/quiescent/commit/3ef99bbcad3b685c1a54ae389a8204e3082d8834))
* store document-relative images in Git LFS with portable delivery ([6c4790a](https://github.com/ncrmro/quiescent/commit/6c4790aec6dd7c80ca4ff53fd524c1159c5d061b))
* unify document caching across D1 and local SQLite ([bf2a9bd](https://github.com/ncrmro/quiescent/commit/bf2a9bd2a72ad126791a4e112c6c7af6b40b9f7f))


### Bug Fixes

* harden document caching, editor contracts and media delivery ([1ddb477](https://github.com/ncrmro/quiescent/commit/1ddb477c19cb2a9637e4e56316713070fc0efc8e))
* keep new documents local until their first save ([ff02916](https://github.com/ncrmro/quiescent/commit/ff02916233e2e7435afb4b08b1b2c635071f65c0))
* preserve imported originals across document edits ([b3ce425](https://github.com/ncrmro/quiescent/commit/b3ce425193fbaeb8eba58239802fea27b3ad4991))


### Performance Improvements

* batch document listing reads and keep media reads read-only ([6ea629c](https://github.com/ncrmro/quiescent/commit/6ea629c6e4f5f97debf19a756fa5126a54dc78c8))


### Code Refactoring

* make document workflows collection agnostic ([6ba36b9](https://github.com/ncrmro/quiescent/commit/6ba36b9a55d17428a6e69fdcebe8e2ea86a40680))
* **server:** remove legacy draft APIs ([ca2fbcf](https://github.com/ncrmro/quiescent/commit/ca2fbcf172cd2a43113a0490b1b2cd3ac08ece36))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @quiescent/git bumped from ^0.2.0 to ^0.3.0

## [0.2.0](https://github.com/ncrmro/quiescent/compare/quiescent-server-v0.1.0...quiescent-server-v0.2.0) (2026-07-05)


### ⚠ BREAKING CHANGES

* publish under the @quiescent npm org; storage-agnostic server

### Features

* publish under the [@quiescent](https://github.com/quiescent) npm org; storage-agnostic server ([e0ddf8e](https://github.com/ncrmro/quiescent/commit/e0ddf8e0d8efd90f0495cced5bdd05f721909f26))
* **server:** configurable OAuth callback path via OAUTH_CALLBACK_PATH ([58858f6](https://github.com/ncrmro/quiescent/commit/58858f6ddf5ed70c3852cdd98517a1527b68eb5e))
* **server:** extract worker-side lib into @ncrmro/quiescent-server ([8ab3a53](https://github.com/ncrmro/quiescent/commit/8ab3a530599f1d14d9c3a8c3f654f6ce81aab6af))
