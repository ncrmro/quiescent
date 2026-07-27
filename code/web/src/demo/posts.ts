import { demoForge } from "./env.ts";

export interface DemoPost {
  path: string;
  title: string;
  date: string;
  tags: string[];
  body: string;
}

/** Minimal frontmatter read for the blog demo's list and post views. */
export function parsePost(path: string, source: string): DemoPost {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const front = block?.[1] ?? "";
  const field = (name: string) =>
    front.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m"))?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  const tags = field("tags")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    path,
    title: field("title") || path.split("/").pop() || path,
    date: field("date"),
    tags,
    body: block ? source.slice(block[0].length) : source,
  };
}

/** Posts straight out of the stubbed forge, newest first. */
export function listPosts(): DemoPost[] {
  const posts: DemoPost[] = [];
  for (const [path, source] of demoForge.files) {
    if (!path.startsWith("content/blog/") || !path.endsWith(".md")) continue;
    posts.push(parsePost(path, source));
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export function getPost(path: string): DemoPost | null {
  const source = demoForge.files.get(path);
  return source === undefined ? null : parsePost(path, source);
}

/** Route slug for a post path, e.g. content/blog/x.md → x. */
export function postSlug(path: string): string {
  return path.replace(/^content\/blog\//, "").replace(/\.md$/, "");
}
