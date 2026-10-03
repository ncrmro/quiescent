import { buildWikiIndex, resolveWikiTarget } from "./graph.ts";
import { normalizeName, type WikiOptions } from "./notes.ts";

export interface DeadLink {
  target: string;
  count: number;
  /** Wiki-relative paths of notes that contain this dead link. */
  sources: string[];
}

export interface LinkReport {
  totalOccurrences: number;
  uniqueTargets: number;
  resolved: number;
  dead: DeadLink[];
}

/** Scan every note's `[[wikilinks]]` and report which targets do not resolve. */
export function validateWikiLinks(options: WikiOptions): LinkReport {
  const index = buildWikiIndex(options);
  const dead = new Map<string, DeadLink>();
  let totalOccurrences = 0;
  const seenTargets = new Set<string>();

  for (const note of index.notes) {
    for (const raw of note.links) {
      const target = raw.split("|")[0]!.split("#")[0]!.trim();
      if (!target) continue;
      totalOccurrences++;
      seenTargets.add(normalizeName(target));
      if (resolveWikiTarget(target, index) === null) {
        const entry = dead.get(target) ?? { target, count: 0, sources: [] };
        entry.count++;
        if (!entry.sources.includes(note.relPath)) entry.sources.push(note.relPath);
        dead.set(target, entry);
      }
    }
  }

  const deadList = [...dead.values()].sort((a, b) => b.count - a.count);
  return {
    totalOccurrences,
    uniqueTargets: seenTargets.size,
    resolved: seenTargets.size - deadList.length,
    dead: deadList,
  };
}

/**
 * CLI-style runner for CI: prints a report and returns the exit code.
 * Wire it up as e.g. `bun -e 'import("@quiescent/wiki").then(m => process.exit(m.reportWikiLinks({ dir: "wiki" })))'`
 * or a two-line script.
 */
export function reportWikiLinks(options: WikiOptions): number {
  const report = validateWikiLinks(options);
  console.log(
    `wiki links: ${report.totalOccurrences} occurrences, ${report.uniqueTargets} unique targets, ` +
      `${report.resolved} resolved, ${report.dead.length} dead`,
  );
  if (report.dead.length === 0) {
    console.log("✓ no dead wikilinks");
    return 0;
  }
  console.error(`\n✗ ${report.dead.length} dead wikilink target(s):`);
  for (const link of report.dead) {
    console.error(`  ${link.count}×  [[${link.target}]]`);
    for (const source of link.sources) console.error(`        in ${source}`);
  }
  return 1;
}
