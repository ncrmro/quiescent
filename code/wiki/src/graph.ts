// Build-time only — see notes.ts. Indexes every note by the names an
// Obsidian-style `[[wikilink]]` may reference it by: its filename basename and
// its frontmatter `title` (source notes are `<dir>/source.md`, so they only
// resolve by title). Shared by the remark plugin, the dead-link validator,
// and the graph/search builders — one source of truth.
import path from "node:path";
import { normalizeName, scanNotes, type WikiNote, type WikiOptions } from "./notes.ts";

export interface WikiIndex {
  /** Normalised name (basename or title) → note URL. */
  urlByName: Map<string, string>;
  /** Names that map to more than one distinct URL (excluded from resolution). */
  ambiguous: Set<string>;
  notes: WikiNote[];
}

const cache = new Map<string, WikiIndex>();

export function buildWikiIndex(options: WikiOptions): WikiIndex {
  // Keyed on base too: the same directory mounted under a different prefix
  // yields different note URLs.
  const key = `${path.resolve(options.dir)}\n${options.base ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const notes = scanNotes(options);
  const urlByName = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const note of notes) {
    for (const name of [note.basename, note.title]) {
      if (!name) continue;
      const nameKey = normalizeName(name);
      const existing = urlByName.get(nameKey);
      if (existing && existing !== note.url) ambiguous.add(nameKey);
      else urlByName.set(nameKey, note.url);
    }
  }

  const index = { urlByName, ambiguous, notes };
  cache.set(key, index);
  return index;
}

/**
 * Resolve a wikilink target (the part before any `|alias`) to a note URL, or
 * `null` if it is dead/ambiguous. A leading `#heading` fragment is ignored;
 * folder- or tag-style targets containing `/` never match a note name.
 */
export function resolveWikiTarget(target: string, index: WikiIndex): string | null {
  const name = target.split("#")[0]!.trim();
  if (!name) return null;
  const key = normalizeName(name);
  if (index.ambiguous.has(key)) return null;
  return index.urlByName.get(key) ?? null;
}

export interface WikiGraphNode {
  /** Note URL, or `tag:<tag>` for tag nodes. */
  id: string;
  url?: string;
  label: string;
  kind: "note" | "tag";
  type?: string;
  /** Edge count, for sizing. */
  degree: number;
}

export interface WikiGraphEdge {
  source: string;
  target: string;
  kind: "link" | "tag";
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
}

/**
 * Notes as nodes, resolved wikilinks as edges; with `includeTags`, tags join
 * as their own nodes with membership edges — the Obsidian-style graph view.
 */
export function buildWikiGraph(
  index: WikiIndex,
  options: { includeTags?: boolean } = {},
): WikiGraph {
  const nodes = new Map<string, WikiGraphNode>();
  const edges: WikiGraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const note of index.notes) {
    nodes.set(note.url, {
      id: note.url,
      url: note.url,
      label: note.title ?? note.basename,
      kind: "note",
      ...(note.type ? { type: note.type } : {}),
      degree: 0,
    });
  }

  const addEdge = (source: string, target: string, kind: "link" | "tag") => {
    if (source === target) return;
    const key = source < target ? `${source}\n${target}` : `${target}\n${source}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ source, target, kind });
    nodes.get(source)!.degree++;
    nodes.get(target)!.degree++;
  };

  function connectNote(note: WikiIndex["notes"][number]) {
    for (const raw of note.links) {
      const url = resolveWikiTarget(raw.split("|")[0]!, index);
      if (url && nodes.has(url)) addEdge(note.url, url, "link");
    }
    if (options.includeTags) {
      for (const tag of note.tags) {
        const id = `tag:${tag}`;
        if (!nodes.has(id)) nodes.set(id, { id, label: tag, kind: "tag", degree: 0 });
        addEdge(note.url, id, "tag");
      }
    }
  }

  index.notes.forEach(connectNote);

  return { nodes: [...nodes.values()], edges };
}

/** Tag → notes carrying it, for tag index pages. Sorted by tag then title. */
export function buildTagIndex(
  index: WikiIndex,
): Record<string, Array<{ url: string; title: string }>> {
  const tags: Record<string, Array<{ url: string; title: string }>> = {};
  for (const note of index.notes) {
    for (const tag of note.tags) {
      tags[tag] ??= [];
      tags[tag].push({ url: note.url, title: note.title ?? note.basename });
    }
  }
  const sorted: typeof tags = {};
  for (const tag of Object.keys(tags).sort()) {
    sorted[tag] = tags[tag]!.sort((a, b) => a.title.localeCompare(b.title));
  }
  return sorted;
}
