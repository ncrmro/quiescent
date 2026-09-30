import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";
import { validateWikiLinks } from "../src/check-links.ts";
import { buildTagIndex, buildWikiGraph, buildWikiIndex, resolveWikiTarget } from "../src/graph.ts";
import { scanNotes } from "../src/notes.ts";
import { buildSearchIndex, SEARCH_OPTIONS } from "../src/search.ts";

const dir = path.join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/wiki");
const opts = { dir };

describe("scanNotes", () => {
  test("parses frontmatter, headings, tags, links, and strips markdown", () => {
    const notes = scanNotes(opts);
    const hydro = notes.find((n) => n.basename === "Hydroponics")!;
    expect(hydro.title).toBe("Hydroponics");
    expect(hydro.type).toBe("concept");
    expect(hydro.status).toBe("active");
    expect(hydro.tags).toEqual(["system/hydroponics", "resource/water"]);
    expect(hydro.created).toBe("2026-07-14");
    expect(hydro.headings).toEqual(["Hydroponics", "Nutrient film technique"]);
    expect(hydro.links).toEqual([
      "Veggie",
      "Water Recovery|the water problem",
      "Plant Growth Paper",
      "Does Not Exist",
    ]);
    // Code fences and markers are stripped; wikilink labels survive.
    expect(hydro.text).not.toContain("flowRate");
    expect(hydro.text).not.toContain("#");
    expect(hydro.text).toContain("the water problem");
    expect(hydro.excerpt.length).toBeLessThanOrEqual(200);
  });

  test("note URLs are lowercase URL-safe slugs matching Astro glob ids", () => {
    for (const note of scanNotes(opts)) {
      expect(note.url.startsWith("/")).toBe(true);
      expect(note.url).not.toMatch(/\s/);
      expect(note.url).toBe(note.url.toLowerCase());
    }
    const water = scanNotes(opts).find((n) => n.basename === "Water Recovery")!;
    expect(water.url).toBe("/problems/water-recovery");
  });
});

describe("wiki index + link resolution", () => {
  const index = buildWikiIndex(opts);

  test("resolves by basename, case- and whitespace-insensitive", () => {
    expect(resolveWikiTarget("Veggie", index)).toBe("/concepts/veggie");
    expect(resolveWikiTarget("  veggie ", index)).toBe("/concepts/veggie");
  });

  test("resolves source notes by frontmatter title", () => {
    expect(resolveWikiTarget("Plant Growth Paper", index)).toBe(
      "/sources/2026-01-01-plant-paper/source",
    );
  });

  test("folds smart quotes both directions", () => {
    expect(resolveWikiTarget("User's Guide", index)).toBe("/people/users-guide");
    expect(resolveWikiTarget("User’s Guide", index)).toBe("/people/users-guide");
  });

  test("ambiguous titles never resolve", () => {
    expect(index.ambiguous.has("duplicate name")).toBe(true);
    expect(resolveWikiTarget("Duplicate Name", index)).toBeNull();
  });

  test("folder/tag-style targets never match", () => {
    expect(resolveWikiTarget("system/hydroponics", index)).toBeNull();
  });

  test("validateWikiLinks reports exactly the dead targets", () => {
    const report = validateWikiLinks(opts);
    expect(report.dead.map((d) => d.target)).toEqual(["Does Not Exist"]);
    expect(report.dead[0]!.sources).toEqual(["concepts/Hydroponics.md"]);
    expect(report.resolved).toBe(report.uniqueTargets - 1);
  });
});

describe("graph", () => {
  const index = buildWikiIndex(opts);

  test("notes link into an undirected deduped edge set", () => {
    const graph = buildWikiGraph(index);
    // Hydroponics<->Veggie appears in both notes but yields one edge.
    const linkEdges = graph.edges.filter((e) => e.kind === "link");
    const pairs = linkEdges.map((e) => [e.source, e.target].sort().join(" "));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toContain("/concepts/hydroponics /concepts/veggie");
    // Dead link contributes no edge.
    expect(graph.nodes.some((n) => n.label === "Does Not Exist")).toBe(false);
  });

  test("tag nodes join with membership edges and degrees add up", () => {
    const graph = buildWikiGraph(index, { includeTags: true });
    const waterTag = graph.nodes.find((n) => n.id === "tag:resource/water")!;
    expect(waterTag.kind).toBe("tag");
    expect(waterTag.degree).toBe(2); // Hydroponics + Water Recovery
    const totalDegree = graph.nodes.reduce((sum, n) => sum + n.degree, 0);
    expect(totalDegree).toBe(graph.edges.length * 2);
  });

  test("buildTagIndex groups and sorts notes per tag", () => {
    const tags = buildTagIndex(index);
    expect(Object.keys(tags)).toEqual([...Object.keys(tags)].sort());
    expect(tags["system/hydroponics"]!.map((n) => n.title)).toEqual(["Hydroponics", "Veggie"]);
  });
});

describe("search", () => {
  test("serialized index round-trips through MiniSearch.loadJSON and finds hits", () => {
    const serialized = buildSearchIndex(buildWikiIndex(opts));
    const mini = MiniSearch.loadJSON(serialized, SEARCH_OPTIONS);

    const byTitle = mini.search("hydroponics");
    expect(byTitle[0]!.id).toBe("/concepts/hydroponics");
    expect(byTitle[0]!.excerpt).toBeTruthy();

    const byBody = mini.search("nutrient film");
    expect(byBody.map((r) => r.id)).toContain("/concepts/hydroponics");

    const byTag = mini.search("water");
    expect(byTag.map((r) => r.id)).toContain("/problems/water-recovery");

    const byPrefix = mini.search("hydrop");
    expect(byPrefix.length).toBeGreaterThan(0);
  });
});

describe("mount prefix", () => {
  test("base prefixes every note URL and wikilink resolution", () => {
    const based = buildWikiIndex({ dir, base: "/demo/wiki" });
    expect(resolveWikiTarget("Veggie", based)).toBe("/demo/wiki/concepts/veggie");
    for (const note of based.notes) expect(note.url.startsWith("/demo/wiki/")).toBe(true);
    // Slashes in the option are normalised.
    const messy = buildWikiIndex({ dir, base: "docs/" });
    expect(resolveWikiTarget("Veggie", messy)).toBe("/docs/concepts/veggie");
  });
});
