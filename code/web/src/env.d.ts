/// <reference types="astro/client" />

type Env = import("@quiescent/server").Env;
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    session?: import("@quiescent/server").Session;
    sessionId?: string;
  }
}
