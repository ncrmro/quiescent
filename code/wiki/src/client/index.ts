// Browser-side islands: no node imports allowed here.
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import MiniSearch from "minisearch";
import type { WikiGraph, WikiGraphNode } from "../graph.ts";
import { SEARCH_OPTIONS } from "../search.ts";

export interface WikiSearchHit {
  url: string;
  title: string;
  type?: string;
  tags: string;
  excerpt: string;
  score: number;
}

export interface WikiSearch {
  search(query: string, limit?: number): WikiSearchHit[];
}

/** Deserialize a search index produced by buildSearchIndex (string or fetched URL). */
export function loadWikiSearch(serialized: string): WikiSearch {
  const mini = MiniSearch.loadJSON(serialized, SEARCH_OPTIONS);
  return {
    search(query, limit = 20) {
      if (!query.trim()) return [];
      return mini.search(query).slice(0, limit) as unknown as WikiSearchHit[];
    },
  };
}

/** Fetch + deserialize, for an auth-guarded /api/wiki/search-index route. */
export async function fetchWikiSearch(indexUrl: string): Promise<WikiSearch> {
  const response = await fetch(indexUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`search index fetch failed: ${response.status}`);
  return loadWikiSearch(await response.text());
}

interface SimNode extends SimulationNodeDatum, WikiGraphNode {}

export interface WikiGraphViewOptions {
  /** Called on node click; defaults to location.assign for note nodes. */
  onNavigate?: (node: WikiGraphNode) => void;
  /** Hide tag nodes/edges even if present in the data. */
  showTags?: boolean;
  /** Fill colors per note `type` (fallback cycles a built-in palette). */
  colors?: Record<string, string>;
}

export interface WikiGraphView {
  destroy(): void;
}

const PALETTE = ["#6c8ebf", "#82b366", "#b85450", "#9673a6", "#d6b656", "#d79b00", "#5b9aa0"];

/**
 * Force-directed canvas rendering of the wiki graph: color by note type,
 * radius by degree, hover highlights neighbors, click navigates. Sized to the
 * container; call destroy() when the island unmounts.
 */
export function mountWikiGraph(
  container: HTMLElement,
  graph: WikiGraph,
  options: WikiGraphViewOptions = {},
): WikiGraphView {
  const showTags = options.showTags ?? true;
  const nodes: SimNode[] = graph.nodes
    .filter((n) => showTags || n.kind === "note")
    .map((n) => ({ ...n }));
  const ids = new Set(nodes.map((n) => n.id));
  const links: SimulationLinkDatum<SimNode>[] = graph.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const context = canvas.getContext("2d")!;

  const typeColors = new Map<string, string>(Object.entries(options.colors ?? {}));
  const colorFor = (node: SimNode): string => {
    if (node.kind === "tag") return "#8a8a8a";
    const type = node.type ?? "note";
    let color = typeColors.get(type);
    if (!color) {
      color = PALETTE[typeColors.size % PALETTE.length]!;
      typeColors.set(type, color);
    }
    return color;
  };
  const radius = (node: SimNode) => Math.min(4 + Math.sqrt(node.degree) * 1.5, 14);

  let width = 0;
  let height = 0;
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    width = container.clientWidth || 600;
    height = container.clientHeight || 400;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();

  const neighborsOf = (id: string): Set<string> => {
    const near = new Set<string>([id]);
    for (const link of links) {
      const s = (link.source as SimNode).id;
      const t = (link.target as SimNode).id;
      if (s === id) near.add(t);
      if (t === id) near.add(s);
    }
    return near;
  };

  let hovered: SimNode | null = null;

  const draw = () => {
    context.clearRect(0, 0, width, height);
    const near = hovered ? neighborsOf(hovered.id) : null;

    context.lineWidth = 1;
    for (const link of links) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      const active = near && (near.has(s.id) || near.has(t.id)) && (s.id === hovered!.id || t.id === hovered!.id);
      context.strokeStyle = active ? "#666" : "rgba(128,128,128,0.25)";
      context.beginPath();
      context.moveTo(s.x!, s.y!);
      context.lineTo(t.x!, t.y!);
      context.stroke();
    }

    for (const node of nodes) {
      const dimmed = near !== null && !near.has(node.id);
      context.globalAlpha = dimmed ? 0.25 : 1;
      context.fillStyle = colorFor(node);
      context.beginPath();
      context.arc(node.x!, node.y!, radius(node), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    context.font = "11px system-ui, sans-serif";
    context.fillStyle = "#888";
    for (const node of nodes) {
      const emphasized = near?.has(node.id) || (!near && node.degree >= 5);
      if (!emphasized) continue;
      context.fillStyle = near?.has(node.id) ? "#444" : "#888";
      context.fillText(node.label, node.x! + radius(node) + 3, node.y! + 3);
    }
  };

  const simulation = forceSimulation(nodes)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((n) => n.id).distance(50))
    .force("charge", forceManyBody().strength(-80))
    .force("collide", forceCollide<SimNode>().radius((n) => radius(n) + 2))
    .force("center", forceCenter(width / 2, height / 2))
    .on("tick", draw);

  const nodeAt = (x: number, y: number): SimNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!;
      const r = radius(node) + 2;
      const dx = x - node.x!;
      const dy = y - node.y!;
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  };

  const toLocal = (event: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onMove = (event: MouseEvent) => {
    const [x, y] = toLocal(event);
    const hit = nodeAt(x, y);
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit ? "pointer" : "default";
      canvas.title = hit?.label ?? "";
      draw();
    }
  };
  const onClick = (event: MouseEvent) => {
    const [x, y] = toLocal(event);
    const hit = nodeAt(x, y);
    if (!hit) return;
    if (options.onNavigate) options.onNavigate(hit);
    else if (hit.url) window.location.assign(hit.url);
  };
  const onResize = () => {
    resize();
    simulation.force("center", forceCenter(width / 2, height / 2));
    simulation.alpha(0.3).restart();
  };

  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);

  return {
    destroy() {
      simulation.stop();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
}
