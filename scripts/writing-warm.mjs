import { pathToFileURL } from "node:url";
/** @param {string} base @param {Record<string, string>} extraHeaders */
export async function warmSite(base, extraHeaders = {}) {
  const headers = { ...extraHeaders, "Content-Type": "application/json", Origin: base };
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password: process.env.WRITING_TEST_PASSWORD ?? "quiescent-demo" }),
  });
  if (!login.ok)
    throw Object.assign(new Error(`Sign-in failed: ${login.status}`), { status: login.status });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  try {
    for (const collection of ["posts", "recipes"]) {
      const response = await fetch(`${base}/api/documents/${collection}/cache/refresh`, {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
      });
      if (!response.ok) throw new Error(`Cache warming failed: ${response.status}`);
      const result = /** @type {unknown} */ (await response.json());
      if (
        !result ||
        typeof result !== "object" ||
        !("refreshed" in result) ||
        !result.refreshed ||
        !("pages" in result)
      )
        throw new Error("Cache provider is not enabled. Build the application first.");
      console.log(`${collection} page caches are ready (${result.pages} pages).`);
    }
  } finally {
    await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { ...headers, Cookie: cookie },
      body: "{}",
    });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A new Worker version can take a moment to become routable after deployment.
  for (let attempt = 0; ; attempt++) {
    try {
      await warmSite(process.env.BASE_URL ?? "https://quiescent-writing-test.ncrmro.workers.dev");
      break;
    } catch (error) {
      if (
        attempt === 4 ||
        !(
          error instanceof Error &&
          "status" in error &&
          typeof error.status === "number" &&
          [404, 503].includes(error.status)
        )
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
