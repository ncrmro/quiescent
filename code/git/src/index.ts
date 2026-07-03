import { GiteaForge } from "./gitea.ts";
import { GitHubForge } from "./github.ts";
import type { ForgeClient, ForgeConfig } from "./types.ts";

export * from "./types.ts";
export * from "./errors.ts";
export * from "./oauth.ts";
export { GitHubForge } from "./github.ts";
export { GiteaForge, resolveGiteaBaseUrl } from "./gitea.ts";
export { encodeBase64, decodeBase64 } from "./base64.ts";

export function createForge(config: ForgeConfig): ForgeClient {
  switch (config.kind) {
    case "github":
      return new GitHubForge(config);
    case "gitea":
    case "forgejo":
    case "codeberg":
      return new GiteaForge(config);
  }
}
