import type { DeleteSelection, DocumentSelection } from "./contracts.ts";
import { DocumentError } from "./document-error.ts";
import { documentErrorResponse, json, payload } from "./http.ts";
export type RequestData = Record<string, unknown>;
export interface PrivateHttpOptions {
  authorize: (request: Request) => boolean | Promise<boolean>;
}
export function privateHandler(
  options: PrivateHttpOptions,
  handle: (request: Request) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    try {
      if (!(await options.authorize(request))) return json({ error: "Unauthorized" }, 403);
      const url = new URL(request.url);
      if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== url.origin)
        return json({ error: "Invalid request origin" }, 403);
      return await handle(request);
    } catch (error) {
      return documentErrorResponse(error);
    }
  };
}
function selection(id: string, data: RequestData): DocumentSelection {
  if (typeof data.branch !== "string" || typeof data.expectedHeadSha !== "string")
    throw new DocumentError("Draft revision missing", "invalid");
  return { id, branch: data.branch, expectedHeadSha: data.expectedHeadSha };
}
function deletion(id: string, data: RequestData): DeleteSelection {
  if (
    typeof data.expectedHeadSha !== "string" ||
    (data.branch != null && typeof data.branch !== "string")
  )
    throw new DocumentError("Document revision missing", "invalid");
  return { id, expectedHeadSha: data.expectedHeadSha, branch: data.branch ?? null };
}
async function publishedResponse<T extends object>(
  result: T,
  after: (result: T) => Promise<void>,
  deleted: boolean,
) {
  try {
    await after(result);
    return json(result);
  } catch {
    const operation = deleted ? "Deleted" : "Published";
    return json({
      ...result,
      cacheWarning: `${operation} on GitHub, but page warming failed. Refresh the site cache before sharing.`,
    });
  }
}
interface CollectionRoutes<Draft, Published extends object, Deleted extends object> {
  schema: unknown;
  list: () => Promise<Draft[]>;
  create: (data: RequestData) => Promise<Draft>;
  get: (id: string, branch?: string) => Promise<Draft>;
  save: (selection: DocumentSelection, data: RequestData) => Promise<Draft>;
  publish: (selection: DocumentSelection) => Promise<Published>;
  delete: (selection: DeleteSelection) => Promise<Deleted>;
  afterPublish: (result: Published) => Promise<void>;
  afterDelete: (result: Deleted) => Promise<void>;
}
/** Shared CRUD dispatch: presets provide codecs, never a second save/publish implementation. */
export function collectionRoutes<Draft, Published extends object, Deleted extends object>(
  options: CollectionRoutes<Draft, Published, Deleted>,
) {
  async function root(request: Request) {
    if (request.method === "GET") return json(await options.list());
    if (request.method === "POST") return json(await options.create(await payload(request)), 201);
    return json({ error: "Method not allowed" }, 405);
  }
  return async (request: Request, parts: string[]): Promise<Response> => {
    const [id, action] = parts;
    if (parts.length > 2) return json({ error: "Not found" }, 404);
    if (!id) return root(request);
    if (id === "schema" && !action && request.method === "GET") return json(options.schema);
    switch (`${request.method}:${action ?? ""}`) {
      case "GET:":
        return json(
          await options.get(id, new URL(request.url).searchParams.get("branch") ?? undefined),
        );
      case "PUT:": {
        const data = await payload(request);
        return json(await options.save(selection(id, data), data));
      }
      case "POST:publish":
        return publishedResponse(
          await options.publish(selection(id, await payload(request))),
          options.afterPublish,
          false,
        );
      case "DELETE:":
        return publishedResponse(
          await options.delete(deletion(id, await payload(request))),
          options.afterDelete,
          true,
        );
      default:
        return json({ error: "Not found" }, 404);
    }
  };
}
