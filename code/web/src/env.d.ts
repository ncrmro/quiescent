/// <reference types="astro/client" />
/// <reference types="@quiescent/wiki/virtual" />

type Env = import("@quiescent/server").Env & import("./writing/app").WritingEnv;
declare namespace Cloudflare { interface Env extends importEnv {} }
type importEnv = Env;
declare module "cloudflare:workers" { export const env: Cloudflare.Env; }

declare namespace App {
  interface Locals {
    session?: import("@quiescent/server").Session;
    sessionId?: string;
    user?: import("@quiescent/server").WikiUser;
  }
}

declare module "quiescent:runtime" {
 export const env: import("@quiescent/server").Env & import("./writing/app").WritingEnv;
 export const warmFetch:typeof fetch;
 export function hostedMedia(): import("@quiescent/server").MediaStorage | undefined;
}
