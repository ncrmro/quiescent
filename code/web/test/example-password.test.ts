import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordGate, WRITER_COOKIE, writingAuthor } from "../src/writing/auth.ts";

const env = { SERVICE_TOKEN: "a-test-signing-key-not-a-real-token" };
test("example password issues a signed cookie; tampering, wrong passwords and cross-origin login fail", async () => {
  const login = (password: string, origin = "https://example.test") =>
    new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ password }),
    });
  assert.equal((await passwordGate(login("wrong"), env)).status, 401);
  assert.equal((await passwordGate(login("quiescent-demo", "https://evil.test"), env)).status, 403);
  const response = await passwordGate(login("quiescent-demo"), env);
  const cookie = response.headers.get("Set-Cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const valid = new Request("https://example.test/write", {
    headers: { Cookie: cookie.split(";")[0]! },
  });
  assert.equal(await writingAuthor(valid, env), true);
  assert.equal(await writingAuthor(valid, { SERVICE_TOKEN: "another-key" }), false);
  assert.equal(
    await writingAuthor(
      new Request("https://example.test/write", {
        headers: { Cookie: `${WRITER_COOKIE}=fake.fake` },
      }),
      env,
    ),
    false,
  );
});
