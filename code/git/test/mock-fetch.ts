export interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface Route {
  method: string;
  /** Matched against the full URL with String.includes. */
  url: string;
  status?: number;
  response: unknown;
}

export function createMockFetch(routes: Route[]) {
  const requests: RecordedRequest[] = [];

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes.find((r) => r.method === method && url.includes(r.url));
    if (!route) {
      return new Response(JSON.stringify({ message: "no mock route" }), { status: 404 });
    }
    return new Response(JSON.stringify(route.response), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return { mockFetch, requests };
}
