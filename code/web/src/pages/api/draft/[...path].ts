import type { APIRoute } from "astro";
import { deleteDraft, saveDraft } from "../../../lib/drafts.ts";

export const PUT: APIRoute = async ({ locals, params, request }) => {
  const env = locals.runtime.env;
  const session = locals.session!;
  const path = params.path;
  if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400 });

  const body = (await request.json()) as { content?: string; baseSha?: string };
  if (typeof body.content !== "string") {
    return new Response(JSON.stringify({ error: "content required" }), { status: 400 });
  }

  await saveDraft(env, {
    userId: session.userId,
    sessionId: locals.sessionId!,
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
  const env = locals.runtime.env;
  const session = locals.session!;
  if (!params.path) return new Response(null, { status: 400 });
  await deleteDraft(env, session.userId, params.path);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
