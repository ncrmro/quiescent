import { buildWikiIndex, resolveWikiTarget, type WikiIndex } from "./graph.ts";
import { WIKILINK, type WikiOptions } from "./notes.ts";

/**
 * Remark plugin (build-time) that turns Obsidian-style `[[Target]]` and
 * `[[Target|alias]]` into real links to the matching note. Unresolved targets
 * render as a visible `.wikilink--dead` marker (and warn) rather than raw
 * `[[...]]`, so authors can spot broken references. URL resolution shares
 * {@link buildWikiIndex} with the dead-link validator.
 */

// Minimal mdast shapes — enough to split text nodes without pulling @types/mdast.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
}

/** Split one text node's value into text + link/dead nodes; null if no links. */
function splitWikiLinks(value: string, index: WikiIndex, file: string): MdNode[] | null {
  const wikilink = new RegExp(WIKILINK.source, "g");
  let match = wikilink.exec(value);
  if (match === null) return null; // no wikilinks — leave the text node untouched

  const out: MdNode[] = [];
  let last = 0;
  for (; match !== null; match = wikilink.exec(value)) {
    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    last = match.index + match[0].length;

    const [target = "", alias] = match[1]!.split("|");
    const label = (alias ?? target).trim();
    const url = resolveWikiTarget(target, index);
    if (url) {
      out.push({
        type: "link",
        url,
        data: { hProperties: { className: ["wikilink"] } },
        children: [{ type: "text", value: label }],
      });
    } else {
      console.warn(`[quiescent-wiki] dead link [[${match[1]}]] in ${file}`);
      out.push({
        type: "html",
        value: `<span class="wikilink wikilink--dead" title="unresolved link: ${target.trim()}">${label}</span>`,
      });
    }
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(node: MdNode, index: WikiIndex, file: string): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const split = splitWikiLinks(child.value, index, file);
      if (split) {
        next.push(...split);
        continue;
      }
    }
    // Don't descend into links (avoid nesting) or code; recurse elsewhere.
    if (child.type !== "link" && child.type !== "inlineCode" && child.type !== "code") {
      transform(child, index, file);
    }
    next.push(child);
  }
  node.children = next;
}

export function remarkWikiLinks(options: WikiOptions) {
  return () => {
    const index = buildWikiIndex(options);
    return (tree: MdNode, vfile: { path?: string }) => {
      transform(tree, index, vfile?.path ?? "<unknown>");
    };
  };
}
