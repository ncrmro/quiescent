import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { deleteDraft, saveDraft } from "@quiescent/server";

export const PUT: APIRoute = async ({ locals, params, request }) => {

  const user = locals.user!;
  const path = params.path;
  if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400 });

  const body = (await request.json()) as { content?: string; baseSha?: string };
  if (typeof body.content !== "string") {
    return new Response(JSON.stringify({ error: "content required" }), { status: 400 });
  }

  await saveDraft(env, {
    user,
    sessionId: locals.sessionId,
    path,
    content: body.content,
    baseSha: body.baseSha,
    updatedAt: Date.now(),
  });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

// navigator.sendBeacon can only POST.
export const POST = PUT;

export const DELETE: APIRoute = async ({ locals, params }) => {

  const user = locals.user!;
  if (!params.path) return new Response(null, { status: 400 });
  await deleteDraft(env, user.id, params.path);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
