/// <reference types="astro/client" />
/// <reference types="@quiescent/wiki/virtual" />

type Env = import("@quiescent/server").Env & import("./writing/app").WritingEnv;
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    session?: import("@quiescent/server").Session;
    sessionId?: string;
    user?: import("@quiescent/server").WikiUser;
  }
}
