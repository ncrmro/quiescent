import { AwsClient } from "aws4fetch";
import type { ConfirmedUpload, UploadTicket } from "./contracts.ts";

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID = /^[a-zA-Z0-9-]{1,80}$/;
export interface MediaObject {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
}
/** Structural interface: an R2 binding satisfies this without a platform dependency. */
export interface MediaBucket {
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    size: number;
    httpMetadata?: { contentType?: string };
  } | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
}
export interface MediaStorage {
  prepare(postId: string, contentType: string, size: number): Promise<UploadTicket>;
  confirm(postId: string, assetId: string): Promise<ConfirmedUpload>;
  read(postId: string, assetId: string): Promise<MediaObject | null>;
  verify(postId: string, assetId: string): Promise<void>;
  uploadLocal?(postId: string, assetId: string, request: Request): Promise<void>;
}
export class MediaError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function key(postId: string, assetId: string, staging = false) {
  if (!ID.test(postId) || !ID.test(assetId)) throw new MediaError("Invalid image reference");
  return `${staging ? "uploads" : "images"}/${postId}/${assetId}`;
}
function metadata(contentType: string, size: number) {
  if (!TYPES.has(contentType) || !Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_SIZE)
    throw new MediaError("Choose a JPEG, PNG, or WebP image up to 10 MB.");
}
async function bounded(body: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_IMAGE_SIZE) {
        await reader.cancel();
        throw new MediaError("Image exceeds 10 MB.", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
function validateBytes(bytes: ArrayBuffer, type: string) {
  metadata(type, bytes.byteLength);
  const b = new Uint8Array(bytes);
  const ok =
    type === "image/jpeg"
      ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)
        : new TextDecoder().decode(b.slice(0, 4)) === "RIFF" &&
          new TextDecoder().decode(b.slice(8, 12)) === "WEBP";
  if (!ok) throw new MediaError("The file does not match its image type.");
}
async function digest(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
interface ObjectStore {
  get(key: string): Promise<MediaObject | null>;
  put(key: string, bytes: ArrayBuffer, type: string): Promise<void>;
}
function createMedia(
  store: ObjectStore,
  prepare: MediaStorage["prepare"],
  uploadLocal?: MediaStorage["uploadLocal"],
): MediaStorage {
  return {
    prepare,
    ...(uploadLocal ? { uploadLocal } : {}),
    async confirm(postId, assetId) {
      const object = await store.get(key(postId, assetId, true));
      if (!object) throw new MediaError("Upload not found. Please upload the image again.", 404);
      metadata(object.contentType, object.size);
      const bytes = await bounded(object.body);
      validateBytes(bytes, object.contentType);
      // Public references are content addressed. A replayed upload URL cannot alter them.
      const permanentId = await digest(bytes);
      await store.put(key(postId, permanentId), bytes, object.contentType);
      return { src: `/media/${postId}/${permanentId}` };
    },
    read(postId, assetId) {
      return store.get(key(postId, assetId));
    },
    async verify(postId, assetId) {
      const object = await store.get(key(postId, assetId));
      if (!object)
        throw new MediaError("An image is missing. Upload it again before publishing.", 409);
      await object.body.cancel();
      metadata(object.contentType, object.size);
    },
  };
}
/** Local R2 emulation uses the same finalization flow, with a loopback upload endpoint. */
export function localR2Media(bucket: MediaBucket, apiBase = "/api/writing"): MediaStorage {
  const store: ObjectStore = {
    async get(k) {
      const o = await bucket.get(k);
      if (!o) return null;
      const type = o.httpMetadata?.contentType ?? "";
      metadata(type, o.size);
      return { body: new Response(await o.arrayBuffer()).body!, size: o.size, contentType: type };
    },
    async put(k, b, t) {
      await bucket.put(k, b, { httpMetadata: { contentType: t } });
    },
  };
  return createMedia(
    store,
    async (postId, type, size) => {
      metadata(type, size);
      const assetId = crypto.randomUUID();
      key(postId, assetId);
      return {
        assetId,
        url: `${apiBase}/posts/${postId}/uploads/${assetId}`,
        headers: { "Content-Type": type },
      };
    },
    async (postId, assetId, request) => {
      if (!request.body) throw new MediaError("Image body missing");
      const bytes = await bounded(request.body);
      const type = request.headers.get("Content-Type") ?? "";
      validateBytes(bytes, type);
      await store.put(key(postId, assetId, true), bytes, type);
    },
  );
}
/** Direct browser uploads use a signed staging URL; the Worker seals validated content. */
export function r2Media(options: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: typeof fetch;
}): MediaStorage {
  if (
    !/^[a-f0-9]{32}$/.test(options.accountId) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.bucket)
  )
    throw new MediaError("Invalid R2 configuration", 503);
  const aws = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const send = options.fetch ?? fetch;
  const url = (k: string) =>
    `https://${options.accountId}.r2.cloudflarestorage.com/${options.bucket}/${k}`;
  const store: ObjectStore = {
    async get(k) {
      const response = await send(await aws.sign(url(k), { method: "GET" }));
      if (response.status === 404) return null;
      if (!response.ok || !response.body)
        throw new MediaError("Image storage is unavailable. Try again.", 502);
      return {
        body: response.body,
        size: Number(response.headers.get("Content-Length")),
        contentType: response.headers.get("Content-Type") ?? "",
      };
    },
    async put(k, bytes, type) {
      const response = await send(
        await aws.sign(url(k), { method: "PUT", headers: { "Content-Type": type }, body: bytes }),
      );
      if (!response.ok) throw new MediaError("Could not finish saving the image. Try again.", 502);
    },
  };
  return createMedia(store, async (postId, type, size) => {
    metadata(type, size);
    const assetId = crypto.randomUUID();
    const target = new URL(url(key(postId, assetId, true)));
    target.searchParams.set("X-Amz-Expires", "300");
    const signed = await aws.sign(target, {
      method: "PUT",
      headers: { "Content-Type": type },
      aws: { signQuery: true, allHeaders: true },
    });
    return { assetId, url: signed.url, headers: { "Content-Type": type } };
  });
}
