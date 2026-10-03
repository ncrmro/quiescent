import { json, payload } from "./http.ts";
import { MediaError, type MediaStorage } from "./media.ts";

function uploadOperation(
  method: string,
  asset: string | undefined,
  operation: string | undefined,
  local: boolean,
) {
  if (!asset && !operation && method === "POST") return "prepare";
  if (asset && operation === "confirm" && method === "POST") return "confirm";
  if (asset && !operation && method === "PUT" && local) return "put";
  return null;
}
async function prepare(request: Request, id: string, branch: string, media: MediaStorage) {
  const data = await payload(request);
  if (typeof data.contentType !== "string" || typeof data.size !== "number")
    throw new MediaError("Image metadata missing");
  const ticket = await media.prepare(id, data.contentType, data.size);
  if (media.uploadLocal) {
    const target = new URL(ticket.url, request.url);
    target.searchParams.set("branch", branch);
    ticket.url = target.pathname + target.search;
  }
  return json(ticket);
}
export async function upload(
  request: Request,
  parts: string[],
  service: { readDraft(id: string, branch: string): Promise<unknown | null> },
  media: MediaStorage,
) {
  const [id, asset, operation] = parts;
  if (!id || parts.length > 3) return json({ error: "Not found" }, 404);
  const action = uploadOperation(request.method, asset, operation, !!media.uploadLocal);
  if (!action) return json({ error: "Not found" }, 404);
  const branch = new URL(request.url).searchParams.get("branch");
  if (!branch || !(await service.readDraft(id, branch)))
    throw new MediaError("Save a draft before uploading an image.", 409);
  if (action === "prepare") return prepare(request, id, branch, media);
  if (action === "confirm") {
    const data = await payload(request);
    return json(
      await media.confirm(
        id,
        asset!,
        typeof data.filename === "string" ? data.filename : undefined,
      ),
    );
  }
  await media.uploadLocal!(id, asset!, request);
  return json({ ok: true });
}
export function mediaResponse(object: Awaited<ReturnType<MediaStorage["read"]>>) {
  return object
    ? new Response(object.body, {
        headers: {
          "Content-Type": object.contentType,
          "Content-Length": String(object.size),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    : json({ error: "Image not found" }, 404);
}
