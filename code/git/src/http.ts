import { ForgeError } from "./errors.ts";

export interface HttpClient {
  request(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createHttpClient(options: {
  apiBase: string;
  token: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}): HttpClient {
  const fetchImpl = options.fetch ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${options.apiBase}${path}`;
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/json",
        // GitHub rejects requests without a User-Agent.
        "User-Agent": "quiescent",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "");
      throw new ForgeError(
        `${init.method ?? "GET"} ${url} failed: ${response.status} ${body.slice(0, 300)}`,
        response.status,
        url,
      );
    }
    return response;
  }

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await request(path, init);
    if (response.status === 404) {
      throw new ForgeError(`${init.method ?? "GET"} ${options.apiBase}${path} failed: 404`, 404, `${options.apiBase}${path}`);
    }
    return (await response.json()) as T;
  }

  return { request, json };
}
