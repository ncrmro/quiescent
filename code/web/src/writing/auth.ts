/** Deliberately fixed password for this example, not a reusable account system. */
export const DEMO_PASSWORD = "quiescent-demo";
export const WRITER_COOKIE = "quiescent.writer";
const duration = 7 * 86400;
const bytes = new TextEncoder();
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
async function key(secret: string) {
  if (!secret) throw new Error("Configure SERVICE_TOKEN before signing in.");
  return crypto.subtle.importKey(
    "raw",
    bytes.encode(`quiescent-demo-cookie:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function writingAuthor(request: Request, env: { SERVICE_TOKEN?: string }) {
  const value = request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${WRITER_COOKIE}=`))
    ?.slice(WRITER_COOKIE.length + 1);
  if (!value || !env.SERVICE_TOKEN) return false;
  try {
    const [payload, signature, ...extra] = value.split(".");
    if (!payload || !signature || extra.length) return false;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(env.SERVICE_TOKEN),
        decode(signature),
        bytes.encode(payload),
      ))
    )
      return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    return data.writer === true && Number.isSafeInteger(data.exp) && data.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}
export async function passwordGate(
  request: Request,
  env: { SERVICE_TOKEN?: string },
): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers });
  if (request.headers.get("Origin") !== url.origin)
    return new Response("Invalid origin", { status: 403, headers });
  const attributes = `Path=/; HttpOnly; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`;
  if (url.pathname === "/api/auth/logout") {
    headers.set("Set-Cookie", `${WRITER_COOKIE}=; Max-Age=0; ${attributes}`);
    return Response.json({ ok: true }, { headers });
  }
  if (url.pathname !== "/api/auth/login")
    return new Response("Not found", { status: 404, headers });
  let password: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) return new Response("Too large", { status: 413, headers });
    password = JSON.parse(body).password;
  } catch {
    return new Response("Invalid request", { status: 400, headers });
  }
  const signingKey = await key(env.SERVICE_TOKEN ?? "");
  const expected = await crypto.subtle.sign("HMAC", signingKey, bytes.encode(DEMO_PASSWORD));
  if (
    typeof password !== "string" ||
    !(await crypto.subtle.verify("HMAC", signingKey, expected, bytes.encode(password)))
  )
    return Response.json(
      { error: "That password did not work. Please try again." },
      { status: 401, headers },
    );
  const payload = encode(
    bytes.encode(
      JSON.stringify({
        writer: true,
        exp: Math.floor(Date.now() / 1000) + duration,
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  const signature = encode(
    new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, bytes.encode(payload))),
  );
  headers.set(
    "Set-Cookie",
    `${WRITER_COOKIE}=${payload}.${signature}; Max-Age=${duration}; ${attributes}`,
  );
  return Response.json({ ok: true }, { headers });
}
