/// <reference types="astro/client" />

type Env = import("./lib/env.ts").Env;
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    session?: import("./lib/session.ts").Session;
    sessionId?: string;
  }
}
