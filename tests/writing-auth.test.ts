import { describe, expect, test } from "bun:test";
import { writingAuthor } from "../code/web/src/writing/app";

describe("hosted writing authorization", () => {
  const env = { WRITING_TEST:"true", WRITING_PASSWORD:"test-password", WRITING_LOCAL:"true" } as const;
  const request = (url:string, password?:string) => new Request(url, {headers:password ? {Authorization:`Basic ${btoa(`writer:${password}`)}`} : {}});
  test("requires the hosted password even for local hostnames", () => {
    expect(writingAuthor(request("https://localhost/write"),env)).toBe(false);
    expect(writingAuthor(request("https://test.example/write","incorrect"),env)).toBe(false);
    expect(writingAuthor(request("https://test.example/write","test-password"),env)).toBe(true);
  });
  test("fails closed without a secret and over plaintext", () => {
    expect(writingAuthor(request("https://test.example/write","test-password"),{WRITING_TEST:"true"})).toBe(false);
    expect(writingAuthor(request("http://test.example/write","test-password"),env)).toBe(false);
  });
});
