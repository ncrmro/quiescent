/** Filenames are document-relative, never URLs or traversal paths. */
export const assetFilenamePattern =
  /^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*\.(?:png|jpe?g|webp|gif)$/i;
export function isAssetFilename(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && assetFilenamePattern.test(value);
}
export function assetContentType(name: string) {
  if (!isAssetFilename(name)) throw new Error("Invalid media filename");
  return /\.gif$/i.test(name)
    ? "image/gif"
    : /\.png$/i.test(name)
      ? "image/png"
      : /\.webp$/i.test(name)
        ? "image/webp"
        : "image/jpeg";
}
export function uploadedFilename(name: string, type: string, oid: string) {
  const base =
    name
      .replace(/\.[^.]*$/, "")
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "image";
  const extension =
    type === "image/gif"
      ? "gif"
      : type === "image/png"
        ? "png"
        : type === "image/webp"
          ? "webp"
          : "jpg";
  return `${base}-${oid.slice(0, 12)}.${extension}`;
}
/** Hosts serve this route through their configured delivery adapter; source Markdown stays portable. */
export function documentMediaUrl(
  id: string,
  src: string,
  options: { apiBase?: string; branch?: string; revision?: string } = {},
) {
  const base = options.apiBase ?? "";
  const path = `/media/${encodeURIComponent(id)}/${encodeURIComponent(src)}`;
  const query = new URLSearchParams();
  if (options.branch) query.set("branch", options.branch);
  if (options.revision) query.set("v", options.revision);
  return `${base}${path}${query.size ? `?${query}` : ""}`;
}
