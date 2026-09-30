import { expect, test } from "bun:test";
import { passwordGate, WRITER_COOKIE, writingAuthor } from "../../web/src/writing/auth.ts";

const env = { SERVICE_TOKEN: "a-test-signing-key-not-a-real-token" };
test("example password issues a signed cookie; tampering, wrong passwords and cross-origin login fail", async () => {
  const login = (password: string, origin = "https://example.test") =>
    new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ password }),
    });
  expect((await passwordGate(login("wrong"), env)).status).toBe(401);
  expect((await passwordGate(login("quiescent-demo", "https://evil.test"), env)).status).toBe(403);
  const response = await passwordGate(login("quiescent-demo"), env);
  const cookie = response.headers.get("Set-Cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  const valid = new Request("https://example.test/write", {
    headers: { Cookie: cookie.split(";")[0]! },
  });
  expect(await writingAuthor(valid, env)).toBe(true);
  expect(await writingAuthor(valid, { SERVICE_TOKEN: "another-key" })).toBe(false);
  expect(
    await writingAuthor(
      new Request("https://example.test/write", {
        headers: { Cookie: `${WRITER_COOKIE}=fake.fake` },
      }),
      env,
    ),
  ).toBe(false);
});
