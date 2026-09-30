import { env } from "quiescent:runtime";
import type { APIRoute } from "astro";
import { ConflictError } from "@quiescent/git";
import { flushDrafts, listUserDrafts, MissingAuthorEmailError } from "@quiescent/server";

export const POST: APIRoute = async ({ locals, url }) => {

  const user = locals.user!;
  const drafts = await listUserDrafts(env, user.id);

  try {
    const result = await flushDrafts({
      env,
      origin: url.origin,
      user,
      sessionId: locals.sessionId,
      drafts,
    });
    return new Response(JSON.stringify(result ?? { mode: "noop" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof MissingAuthorEmailError) {
      return new Response(
        JSON.stringify({ error: "missing-email", message: "Set an email on your account to save edits." }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    if (error instanceof ConflictError) {
      return new Response(
        JSON.stringify({ error: "conflict", message: error.message }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    throw error;
  }
};
