import { expect, test } from "bun:test";
import { emptyDocument } from "@quiescent/server/content";
import { findRecoveryRecords, removeRecoveredRecord } from "../src/recovery.ts";

test("offers prior editing cycles newest first without deleting unselected records", () => {
  const record = (title: string, updatedAt: number) =>
    JSON.stringify({
      post: {
        title,
        description: "",
        slug: "unfinished",
        tags: ["food"],
        headerImage: "/media/post/header",
        body: emptyDocument(),
      },
      updatedAt,
    });
  const values = new Map([
    ["post:old-cycle:tab-a", record("Unfinished old title", 20)],
    ["post:new-cycle:tab-b", record("Other writing", 10)],
    ["different-post:draft", record("Unrelated", 30)],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const candidates = findRecoveryRecords(storage, "post:");
  expect(candidates.map((c) => c.post.title)).toEqual(["Unfinished old title", "Other writing"]);
  expect(candidates[0]!.post).toMatchObject({
    slug: "unfinished",
    tags: ["food"],
    headerImage: "/media/post/header",
  });
  expect(values.size).toBe(3);
  removeRecoveredRecord(storage, candidates[0]!);
  expect(values.has("post:new-cycle:tab-b")).toBe(true);
  values.set(candidates[1]!.key, record("Newer writing in another tab", 40));
  removeRecoveredRecord(storage, candidates[1]!);
  expect(values.has(candidates[1]!.key)).toBe(true);
});
