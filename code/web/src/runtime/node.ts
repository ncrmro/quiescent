import { fileMedia } from "@quiescent/server/file-media";
import type { WritingEnv } from "../writing/app";
export const env: WritingEnv = {
  ...process.env,
  WRITING_REPO_OWNER: process.env.WRITING_REPO_OWNER ?? "ncrmro",
  WRITING_REPO_NAME: process.env.WRITING_REPO_NAME ?? "quiescent-writing-demo",
  WRITING_AUTHOR_NAME: process.env.WRITING_AUTHOR_NAME ?? "Example writer",
  WRITING_AUTHOR_EMAIL: process.env.WRITING_AUTHOR_EMAIL ?? "writer@example.invalid",
};
export function hostedMedia() {
  return fileMedia(process.env.WRITING_MEDIA_DIRECTORY ?? "./.writing-media");
}

export const warmFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers)),
      ...(process.env.QUIESCENT_WARM_TOKEN
        ? { "X-Quiescent-Warm": process.env.QUIESCENT_WARM_TOKEN }
        : {}),
    },
  });
