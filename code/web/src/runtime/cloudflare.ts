import { env } from "cloudflare:workers";
import type { CacheFetch } from "@quiescent/astro";

export { env };
export function hostedMedia() {
  return undefined;
}
// Same-Worker public fetch bypasses the Worker. Its service binding includes Workers Cache.
export const warmFetch: CacheFetch = (input) =>
  env.WRITING_SELF.fetch(input instanceof Request ? input.url : String(input), {
    redirect: "manual",
  });
