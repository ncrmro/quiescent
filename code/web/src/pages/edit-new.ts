import type { APIRoute } from "astro";

export const GET: APIRoute = ({ url, redirect }) => {
  const path = url.searchParams.get("path")?.replace(/^\/+/, "");
  if (!path) return redirect("/");
  return redirect(`/edit/${path.split("/").map(encodeURIComponent).join("/")}?new=1`);
};
