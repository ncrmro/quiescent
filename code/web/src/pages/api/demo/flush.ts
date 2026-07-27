import { ConflictError } from "@quiescent/git";
import { flushDrafts, listUserDrafts, MissingAuthorEmailError } from "@quiescent/server";
import type { APIRoute } from "astro";
import { demoEnv, DEMO_USER } from "../../../demo/env.ts";

export const POST: APIRoute = async ({ url }) => {
  const env = demoEnv();
  const drafts = await listUserDrafts(env, DEMO_USER.id);

  try {
    const result = await flushDrafts({ env, origin: url.origin, user: DEMO_USER, drafts });
    return new Response(JSON.stringify(result ?? { mode: "noop" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof MissingAuthorEmailError) {
      return new Response(
        JSON.stringify({ error: "missing-email", message: "Set an email to save edits." }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    if (error instanceof ConflictError) {
      return new Response(JSON.stringify({ error: "conflict", message: error.message }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw error;
  }
};
