import { expect, test } from "bun:test";
import { createLfsClient, lfsObject, lfsPointer, parseLfsPointer } from "../src/lfs.ts";

test("LFS uses batch actions, verifies uploads and never forwards the repository credential", async () => {
  const bytes = new TextEncoder().encode("image bytes").buffer;
  const object = await lfsObject(bytes);
  const requests: Request[] = [];
  const client = createLfsClient({
    endpoint: "https://forge.test/repo.git/info/lfs",
    authorization: "Basic repository-secret",
    fetch: (async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      if (request.url.endsWith("/batch")) {
        const { operation } = await request.json();
        return Response.json({
          objects: [
            {
              ...object,
              actions: {
                [operation]: {
                  href: `https://objects.test/${operation}`,
                  header: { Authorization: "object-secret" },
                },
                ...(operation === "upload"
                  ? { verify: { href: "https://forge.test/verify" } }
                  : {}),
              },
            },
          ],
        });
      }
      return new Response(request.method === "GET" ? bytes : null);
    }) as typeof fetch,
  });
  expect(await client.upload(bytes)).toEqual(object);
  expect(await client.download(object)).toEqual(bytes);
  expect(parseLfsPointer(lfsPointer(object))).toEqual(object);
  expect(requests.map((r) => r.method)).toEqual(["POST", "PUT", "POST", "POST", "GET"]);
  for (const request of requests) {
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("User-Agent")).toBe("quiescent");
    expect(request.headers.get("Authorization")).toBe(
      request.url.endsWith("/batch")
        ? "Basic repository-secret"
        : request.url.endsWith("/verify")
          ? null
          : "object-secret",
    );
  }
});

test("LFS refuses corrupt downloads, oversized objects, and transfer redirects", async () => {
  const object = await lfsObject(new TextEncoder().encode("good").buffer);
  for (const response of [
    new Response("evil"),
    new Response("too large"),
    new Response(null, { status: 302, headers: { Location: "https://other.test" } }),
  ]) {
    const client = createLfsClient({
      endpoint: "https://forge.test/lfs",
      authorization: "test",
      fetch: (async (url) =>
        String(url).endsWith("/batch")
          ? Response.json({
              objects: [
                { ...object, actions: { download: { href: "https://objects.test/file" } } },
              ],
            })
          : response) as typeof fetch,
    });
    await expect(client.download(object)).rejects.toThrow();
  }
  const client = createLfsClient({
    endpoint: "https://forge.test/lfs",
    authorization: "test",
    maxSize: 1,
  });
  await expect(client.download(object)).rejects.toThrow("size limit");
});
