/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />
type ExampleEnv = import("./writing/config").WritingEnv;
declare namespace Cloudflare {
  interface Env
    extends Pick<
      ExampleEnv,
      "SERVICE_TOKEN" | "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY"
    > {}
}
declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
declare module "quiescent:runtime" {
  export function hostedDocumentCache(): import("@quiescent/server").DocumentCacheStorage;
  export function scheduleCacheRefresh(promise: Promise<unknown>): void;
  export const transformImage: import("@quiescent/astro/images").TransformImage;
  export const env: ExampleEnv;
  export const warmFetch: import("@quiescent/astro").CacheFetch;
  export function hostedMedia(): import("@quiescent/server").MediaStorage | undefined;
}
