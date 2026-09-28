import { betterAuth } from "better-auth";
import type { WritingEnv } from "./app";

import { TEST_WRITER_EMAIL } from "./auth-client";
export { TEST_WRITER_EMAIL };

export function writingAuth(env:WritingEnv) {
  if (!env.WRITING_AUTH_DB || !env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error("Writing authentication is not configured");
  }
  return betterAuth({
    database: env.WRITING_AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { expiresIn: 60 * 60 * 24 * 7 },
  });
}
