import type { APIRoute } from "astro";
import { ConflictError } from "@ncrmro/quiescent-git";
import { listUserDrafts } from "@ncrmro/quiescent-server";
import { flushDrafts } from "@ncrmro/quiescent-server";

export const POST: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const session = locals.session!;
  const drafts = await listUserDrafts(env, session.userId);

  try {
    const result = await flushDrafts({
      env,
      origin: url.origin,
      sessionId: locals.sessionId!,
      session,
      drafts,
    });
    return new Response(JSON.stringify(result ?? { mode: "noop" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      return new Response(
        JSON.stringify({ error: "conflict", message: error.message }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    throw error;
  }
};
