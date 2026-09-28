import { GiteaForge } from "./gitea.ts";
import { GitHubForge } from "./github.ts";
import type { ForgeClient, ForgeConfig, PublishingForge } from "./types.ts";

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

/** Fail explicitly instead of pretending every forge supports publication. */
export function requirePublishingForge(forge: ForgeClient): PublishingForge {
  const candidate = forge as Partial<PublishingForge>;
  if (
    typeof candidate.listBranches !== "function" ||
    typeof candidate.compareCommits !== "function" ||
    typeof candidate.mergeBranch !== "function" ||
    typeof candidate.isAncestor !== "function"
  ) {
    throw new Error(`Publishing is not supported by the ${forge.kind} forge adapter`);
  }
  return forge as PublishingForge;
}
