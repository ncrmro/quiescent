# Wiki content conventions

`@quiescent/wiki` works over any directory of markdown, but these conventions
(borrowed from artera's agent-managed wiki) make search, tags, and the graph
meaningful.

## One note per file

Each note is one markdown file whose basename is its name: `concepts/Advanced
Plant Habitat.md`. Spaces are fine — URLs are slugged per path segment
(`/concepts/advanced-plant-habitat`), matching Astro's glob-loader ids.

Sources (ingested papers, transcripts, pages) are directories:
`sources/<YYYY-MM-DD>-<slug>/source.md` plus the original artifacts. Since
every basename is `source.md`, sources resolve as wikilinks **only by their
frontmatter `title`** — always set it.

## Frontmatter

```yaml
---
title: Hydroponics
type: concept       # concept | problem | research | source | person | organization | reference
status: draft       # stub | draft | active | open | reviewed | resolved | superseded | archived
tags:
  - system/hydroponics
  - resource/water
created: 2026-07-14
updated: 2026-07-20
---
```

- `title` drives wikilink resolution and display; keep it unique — duplicate
  names/titles become ambiguous and stop resolving.
- `type` groups index pages and colors the graph.
- Unknown fields pass through untouched (schemas stay permissive).

## Tags

Hierarchical lowercase kebab `namespace/value` strings, 3–7 material tags per
note. Suggested namespaces: `topic/ system/ process/ method/ metric/
resource/ environment/ hazard/ control/ discipline/ evidence/ org/`. Don't
duplicate what `type`/`status` already say. Reuse the existing taxonomy —
browse your tag index page before inventing a new tag.

## Linking

Obsidian-style `[[Target]]` and `[[Target|alias]]`, matched
case-insensitively against basenames and titles (typographic quotes are
folded, so smart-quote transforms don't break links). Targets containing `/`
never match — write the note name, not its path. Dead links render visibly
(`.wikilink--dead`) and `reportWikiLinks` can gate CI on them.

Link liberally: the graph and backlinks are only as good as the edges.

## Change log (optional but recommended)

Keep an append-only `log.md` at the wiki root; one line per meaningful
change: `- YYYY-MM-DD — <action>: <note> — <summary>` with actions like
`create | update | rename | move | archive | supersede | ingest | correction`.
With quiescent editing enabled, flush commits give you the same audit trail
in git history.
