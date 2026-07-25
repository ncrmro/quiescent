// Build-time only (uses node:fs) — do NOT import from pages/components that
// run on the Workers runtime. The Astro integration bakes the results into
// the bundle via virtual:quiescent-wiki instead.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { slug as githubSlug } from "github-slugger";
import { parse as parseYaml } from "yaml";

export interface WikiOptions {
  /** Absolute path to the wiki root directory. */
  dir: string;
}

/** The Obsidian-style `[[...]]` link syntax; captures the inner target text. */
export const WIKILINK = /\[\[([^\]]+)\]\]/g;

export interface WikiNote {
  /** Path relative to the wiki root, e.g. `concepts/Advanced Plant Habitat.md`. */
  relPath: string;
  /** Route URL, e.g. `/concepts/advanced-plant-habitat`. */
  url: string;
  title: string | null;
  basename: string;
  type?: string;
  status?: string;
  /** Hierarchical `namespace/value` tags from frontmatter. */
  tags: string[];
  headings: string[];
  /** First ~200 characters of the stripped body. */
  excerpt: string;
  /** Markdown-stripped body for search indexing. */
  text: string;
  /** Raw inner text of each `[[wikilink]]` in the note, in source order. */
  links: string[];
  created?: string;
  updated?: string;
}

/**
 * The URL id for a note, derived from its wiki-relative source path — each path
 * segment run through github-slugger, exactly as Astro's glob loader computes
 * the collection `id`, so wikilink hrefs line up with the real routes.
 */
export function noteId(relPath: string): string {
  return (
    relPath
      .replace(/\.md$/, "")
      .split("/")
      // Wrap so Array#map's index isn't passed as github-slugger's second arg
      // (`maintainCase`), which would preserve case on every segment after the
      // first and break the match with Astro's lowercase `entry.id`.
      .map((segment) => githubSlug(segment))
      .join("/")
  );
}

/**
 * Normalise a note name/title for matching. Case- and whitespace-insensitive,
 * and fold typographic punctuation to ASCII — Astro's smart-quotes transform
 * rewrites `'`/`"` in markdown to curly forms before the wikilink plugin runs,
 * so a `[[User's Guide]]` link must still match a `User's Guide.md` file.
 */
export function normalizeName(name: string): string {
  return name
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

interface Frontmatter {
  title: string | null;
  type?: string;
  status?: string;
  tags: string[];
  created?: string;
  updated?: string;
  body: string;
}

function asDateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function parseFrontmatter(source: string): Frontmatter {
  const none: Frontmatter = { title: null, tags: [], body: source };
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!block) return none;
  let data: unknown;
  try {
    data = parseYaml(block[1]!);
  } catch {
    return none; // malformed frontmatter reads as a plain note
  }
  if (typeof data !== "object" || data === null) return none;
  const fm = data as Record<string, unknown>;
  const tags = Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [];
  return {
    title: typeof fm.title === "string" ? fm.title : null,
    type: typeof fm.type === "string" ? fm.type : undefined,
    status: typeof fm.status === "string" ? fm.status : undefined,
    tags,
    created: asDateString(fm.created),
    updated: asDateString(fm.updated),
    body: source.slice(block[0].length),
  };
}

function extractHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const match of body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    headings.push(match[1]!);
  }
  return headings;
}

/** Cheap markdown → plain text for search indexing; heuristic but sufficient. */
function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`[^`\n]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => inner.split("|").pop() ?? "") // wikilinks → label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/<[^>]+>/g, " ") // html tags
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/^[-*+]\s+|^\d+\.\s+/gm, "") // list markers
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/[*_~]{1,3}/g, "") // emphasis
    .replace(/^\|.*\|$/gm, (row) => row.replace(/\|/g, " ")) // table pipes
    .replace(/^ *[-:| ]+ *$/gm, " ") // table rules
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(source: string): string[] {
  const links: string[] = [];
  for (const match of source.matchAll(new RegExp(WIKILINK.source, "g"))) {
    links.push(match[1]!);
  }
  return links;
}

/** Scan the wiki tree into fully parsed notes, sorted by relPath. */
export function scanNotes(options: WikiOptions): WikiNote[] {
  const notes: WikiNote[] = [];
  for (const file of listMarkdown(options.dir).sort()) {
    const relPath = path.relative(options.dir, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    const fm = parseFrontmatter(source);
    const text = stripMarkdown(fm.body);
    notes.push({
      relPath,
      url: `/${noteId(relPath)}`,
      title: fm.title,
      basename: path.basename(relPath, ".md"),
      type: fm.type,
      status: fm.status,
      tags: fm.tags,
      headings: extractHeadings(fm.body),
      excerpt: text.slice(0, 200),
      text,
      links: extractLinks(source),
      created: fm.created,
      updated: fm.updated,
    });
  }
  return notes;
}
