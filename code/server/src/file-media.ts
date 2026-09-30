import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { localR2Media, type MediaBucket } from "./media.ts";
/** Persistent media for the self-hosted example; shares the normal upload/finalization logic. */
export function fileMedia(directory: string) {
  const root = resolve(directory);
  const path = (key: string) => {
    if (!/^(uploads|images)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(key))
      throw new Error("Invalid media key");
    return resolve(root, key);
  };
  const bucket: MediaBucket = {
    async get(key) {
      try {
        const value = JSON.parse(await readFile(path(key), "utf8")) as {
          contentType: string;
          body: string;
        };
        const bytes = Buffer.from(value.body, "base64");
        return {
          size: bytes.length,
          httpMetadata: { contentType: value.contentType },
          async arrayBuffer() {
            return Uint8Array.from(bytes).buffer;
          },
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, value, options) {
      const dest = path(key);
      await mkdir(dirname(dest), { recursive: true });
      const temporary = `${dest}.${crypto.randomUUID()}`;
      await writeFile(
        temporary,
        JSON.stringify({
          contentType: options.httpMetadata.contentType,
          body: Buffer.from(value).toString("base64"),
        }),
        { mode: 0o600 },
      );
      await rename(temporary, dest);
    },
  };
  return localR2Media(bucket);
}
