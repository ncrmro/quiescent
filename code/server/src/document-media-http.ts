import { json, payload } from "./http.ts";
import { MediaError, type MediaStorage } from "./media.ts";
export async function upload(
  request: Request,
  parts: string[],
  service: { getDraft(id: string): Promise<unknown> },
  media: MediaStorage,
) {
  const [id, asset, operation] = parts;
  if (!id || parts.length > 3) return json({ error: "Not found" }, 404);
  await service.getDraft(id);
  if (!asset && request.method === "POST") {
    const data = await payload(request);
    if (typeof data.contentType !== "string" || typeof data.size !== "number")
      throw new MediaError("Image metadata missing");
    return json(await media.prepare(id, data.contentType, data.size));
  }
  if (!asset) return json({ error: "Not found" }, 404);
  if (operation === "confirm" && request.method === "POST") {
    const data = await payload(request);
    return json(
      await media.confirm(id, asset, typeof data.filename === "string" ? data.filename : undefined),
    );
  }
  if (!operation && request.method === "PUT" && media.uploadLocal) {
    await media.uploadLocal(id, asset, request);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
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
