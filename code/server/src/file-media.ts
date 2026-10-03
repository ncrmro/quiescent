import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { localR2Media, type MediaBucket } from "./media.ts";

interface FileMetadata {
  version: 2;
  contentType: string;
  oid: string;
  size: number;
}
/** Raw immutable byte files plus small atomic metadata descriptors; legacy JSON remains readable. */
export function fileMedia(directory: string) {
  const root = resolve(directory);
  const path = (key: string) => {
    if (!/^(uploads|images)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(key))
      throw new Error("Invalid media key");
    return resolve(root, key);
  };
  async function atomicWrite(destination: string, bytes: Uint8Array | string) {
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
  }
  async function get(key: string) {
    const destination = path(key);
    const value = JSON.parse(await readFile(destination, "utf8")) as
      | FileMetadata
      | { contentType: string; body: string };
    if ("body" in value) {
      const bytes = Buffer.from(value.body, "base64");
      return {
        body: new Response(bytes).body!,
        size: bytes.length,
        httpMetadata: { contentType: value.contentType },
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      };
    }
    if (
      value.version !== 2 ||
      !/^[a-f0-9]{64}$/.test(value.oid) ||
      !Number.isSafeInteger(value.size) ||
      value.size < 1
    )
      throw new Error("Invalid media metadata");
    const filename = `${destination}.${value.oid}.bin`;
    const file = await open(filename, "r");
    try {
      if ((await file.stat()).size !== value.size) throw new Error("Media size mismatch");
    } catch (error) {
      await file.close().catch(() => undefined);
      throw error;
    }
    return {
      body: Readable.toWeb(file.createReadStream()) as unknown as ReadableStream<Uint8Array>,
      size: value.size,
      httpMetadata: { contentType: value.contentType },
      async arrayBuffer() {
        return Uint8Array.from(await readFile(filename)).buffer;
      },
    };
  }
  const bucket: MediaBucket = {
    async get(key) {
      try {
        return await get(key);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async put(key, value, options) {
      const destination = path(key);
      await mkdir(dirname(destination), { recursive: true });
      const bytes = new Uint8Array(value);
      const oid = createHash("sha256").update(bytes).digest("hex");
      // An open reader keeps its immutable generation even if the staging URL is replayed.
      await atomicWrite(`${destination}.${oid}.bin`, bytes);
      const metadata: FileMetadata = {
        version: 2,
        contentType: options.httpMetadata.contentType,
        oid,
        size: bytes.length,
      };
      await atomicWrite(destination, JSON.stringify(metadata));
    },
  };
  return localR2Media(bucket);
}
