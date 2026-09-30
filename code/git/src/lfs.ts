/** Standard Git LFS pointers and Basic Transfer API, usable from Workers or Node. */
export class LfsError extends Error {}
export interface LfsObject {
  oid: string;
  size: number;
}
export interface LfsStorage {
  upload(bytes: ArrayBuffer): Promise<LfsObject>;
  download(object: LfsObject): Promise<ArrayBuffer>;
}
export async function lfsObject(bytes: ArrayBuffer): Promise<LfsObject> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    oid: [...hash].map((b) => b.toString(16).padStart(2, "0")).join(""),
    size: bytes.byteLength,
  };
}
export function lfsPointer(object: LfsObject) {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${object.oid}\nsize ${object.size}\n`;
}
export function parseLfsPointer(source: string): LfsObject {
  const match =
    /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n$/.exec(
      source,
    );
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new LfsError("Invalid LFS pointer");
  return { oid: match[1]!, size: Number(match[2]) };
}
interface Action {
  href: string;
  header?: Record<string, string>;
}
interface BatchObject extends LfsObject {
  error?: { code: number };
  actions?: { upload?: Action; download?: Action; verify?: Action };
}
async function readDownload(response: Response, limit: number): Promise<ArrayBuffer> {
  if (!response.body) throw new LfsError("Empty LFS download");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new LfsError("LFS download size mismatch");
      }
      chunks.push(chunk.value);
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
export function createLfsClient(options: {
  endpoint: string;
  authorization: string;
  fetch?: typeof fetch;
  maxSize?: number;
}): LfsStorage {
  const send = options.fetch ?? fetch;
  const maxSize = options.maxSize ?? 10 * 1024 * 1024;
  async function batch(operation: "upload" | "download", object: LfsObject) {
    if (object.size > maxSize) throw new LfsError("LFS object exceeds the media size limit");
    const response = await send(`${options.endpoint}/objects/batch`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": "quiescent",
        Authorization: options.authorization,
        Accept: "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json",
      },
      body: JSON.stringify({ operation, transfers: ["basic"], objects: [object] }),
    });
    if (!response.ok)
      throw new LfsError(`LFS ${operation} authorization failed (${response.status})`);
    const data = (await response.json()) as { objects?: BatchObject[]; transfer?: string };
    const result = data.objects?.[0];
    if (
      !result ||
      result.error ||
      result.oid !== object.oid ||
      result.size !== object.size ||
      (data.transfer && data.transfer !== "basic")
    )
      throw new LfsError(`LFS ${operation} did not confirm the requested object`);
    return result.actions;
  }
  async function transfer(action: Action, init: RequestInit) {
    const url = new URL(action.href);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new LfsError("Unsafe LFS transfer URL");
    // Only the action's credentials go to object storage; never forward the repository PAT.
    const response = await send(url, {
      ...init,
      redirect: "manual",
      headers: {
        "User-Agent": "quiescent",
        ...Object.fromEntries(new Headers(init.headers)),
        ...action.header,
      },
    });
    if (!response.ok) throw new LfsError(`LFS ${init.method} transfer failed (${response.status})`);
    return response;
  }
  return {
    async upload(bytes) {
      const object = await lfsObject(bytes);
      const actions = await batch("upload", object);
      if (actions?.upload) await transfer(actions.upload, { method: "PUT", body: bytes });
      if (actions?.verify)
        await transfer(actions.verify, {
          method: "POST",
          headers: { "Content-Type": "application/vnd.git-lfs+json" },
          body: JSON.stringify(object),
        });
      return object;
    },
    async download(object) {
      const actions = await batch("download", object);
      if (!actions?.download) throw new LfsError("LFS download is unavailable");
      const response = await transfer(actions.download, { method: "GET" });
      const bytes = new Uint8Array(await readDownload(response, Math.min(object.size, maxSize)));
      const actual = await lfsObject(bytes.buffer);
      if (actual.oid !== object.oid || actual.size !== object.size)
        throw new LfsError("LFS download hash mismatch");
      return bytes.buffer;
    },
  };
}
