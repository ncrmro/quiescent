import { expect, test } from "bun:test";
import { imageReferences, renderDocument } from "../src/content/document.ts";
import { fromMarkdown, toMarkdown } from "../src/content/markdown.ts";

test("rich writing survives Markdown storage with formatting, links and images", () => {
  const source =
    "## Lunch\n\nEnjoy **peaches** and *cream*, with [friends](https://example.test).\n\n> A quiet day\n\n3. Pick fruit\n4. Share\n\n![Peaches](asset.png)\n\n---\n";
  const doc = fromMarkdown(source);
  const roundtrip = fromMarkdown(toMarkdown(doc));
  expect(renderDocument(roundtrip)).toBe(renderDocument(doc));
  expect(renderDocument(roundtrip)).toContain("<strong>peaches</strong>");
  expect(renderDocument(roundtrip)).toContain('<ol start="3">');
  expect(imageReferences(roundtrip)).toEqual([{ assetId: "asset.png" }]);
});
test("literal HTML-like writing stays text after Markdown serialization", () => {
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "I wrote <script>alert(1)</script> & <b>hello</b>." }],
      },
    ],
  };
  expect(renderDocument(fromMarkdown(toMarkdown(document)))).toBe(renderDocument(document));
});

test("asset discovery accepts Markdown outside the visual editor subset", async () => {
  const { markdownImages } = await import("../src/content/markdown.ts");
  expect(markdownImages("```js\n![Not an image](code.png)\n```\n\n![Garden](garden.png)")).toEqual([
    "garden.png",
  ]);
});
