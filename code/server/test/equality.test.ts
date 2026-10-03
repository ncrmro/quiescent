import { expect, test } from "bun:test";
import { jsonEqual } from "../src/content/equality.ts";

test("semantic JSON equality ignores record ordering but preserves changed content and array order", () => {
  expect(
    jsonEqual(
      { frontmatter: { title: "Same", tags: ["a", "b"] }, body: "Text", id: "one" },
      { id: "one", body: "Text", frontmatter: { tags: ["a", "b"], title: "Same" } },
    ),
  ).toBe(true);
  expect(jsonEqual({ optional: undefined, title: "Same" }, { title: "Same" })).toBe(true);
  expect(jsonEqual(["a", "b"], ["b", "a"])).toBe(false);
  expect(jsonEqual({ body: "Text" }, { body: "Changed" })).toBe(false);
  expect(jsonEqual(null, {})).toBe(false);
  expect(jsonEqual(undefined, null)).toBe(false);
});
