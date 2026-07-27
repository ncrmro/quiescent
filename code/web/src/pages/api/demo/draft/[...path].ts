import { deleteDraft, saveDraft } from "@quiescent/server";
import type { APIRoute } from "astro";
import { demoEnv, DEMO_USER } from "../../../../demo/env.ts";

export const PUT: APIRoute = async ({ params, request }) => {
  const path = params.path;
  if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400 });

  const body = (await request.json()) as { content?: string; baseSha?: string };
  if (typeof body.content !== "string") {
    return new Response(JSON.stringify({ error: "content required" }), { status: 400 });
  }

  await saveDraft(demoEnv(), {
    user: DEMO_USER,
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

export const DELETE: APIRoute = async ({ params }) => {
  if (!params.path) return new Response(null, { status: 400 });
  await deleteDraft(demoEnv(), DEMO_USER.id, params.path);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};
