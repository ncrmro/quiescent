# Package releases

The public packages are `@quiescent/git`, `@quiescent/server`, `@quiescent/editor`,
`@quiescent/astro`, and `@quiescent/wiki`. The example app stays private.

Merge conventional commits into `main`. Release Please opens or updates a release
PR with versions, dependency ranges, and changelogs. The workflow updates `bun.lock`
on that PR and explicitly dispatches CI because changes made using `GITHUB_TOKEN`
do not trigger pull-request workflows. Review the generated versions and CI before
merging the release PR.

After merge, Release Please creates GitHub releases. The publishing job waits for
the shared CI workflow: strict types, lint, tests, packed consumers, Cloudflare and
Node builds, and browser workflows. It verifies every requested package has a
stable GitHub release whose tag points to the checked-out commit and whose version
matches the release manifest. npm publication then runs in dependency order using
OIDC. Already published versions are skipped when retrying a partial batch.

## Registry setup

Each package must exist on npm and trust repository `ncrmro/quiescent`, workflow
`release-please.yml`, via npm trusted publishing. A new package needs its first
publication using maintainer credentials before its trusted publisher can be set.
This is a one-time account setup; do not store an npm token in the repository.
The workflow preflights all selected package names before publishing any of them.

## Retry a failed publication

Dispatch `release-please.yml` at the exact release tag/commit, with `paths` set to a
JSON array of the affected package directories, for example `["code/astro"]`.
The selected packages must have releases at that same commit. Do not dispatch from
a later main-branch commit: the release verification intentionally rejects it.
Checks run again before publication. Do not increment versions solely to retry a
failed publish; the existing published versions are skipped.
