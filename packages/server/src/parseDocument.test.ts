import { parseDocument } from "./parseDocument";
import { useTempDocument } from "./test.utils";
import { Document } from "./parseDocument";

interface Post extends Document {
  description: string;
}

test("success", async () => {
  const { documentConfig, documentFilename } = await useTempDocument(
    {
      additionalKeys: {
        description: {
          required: true,
          type: "string",
        },
      },
    },
    `
---
title: Test
tags: foo,bar
description: I'm a test description
---

hello world
  `
  );
  const document = await parseDocument<Post>(documentConfig, documentFilename);
  expect(document.title).toBe("Test");
  expect(document.slug).toBe("moon-flyby");
  expect(document.date).toBe("1969-07-20");
  expect(document.content).toBe("\n\n\nhello world\n  ");
  expect(document.tags).toStrictEqual(["foo", "bar"]);
  expect(document.description).toBe("I'm a test description");
});
