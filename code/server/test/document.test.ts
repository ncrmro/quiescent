import { describe, expect, test } from "bun:test";
import {
  emptyDocument,
  imageReferences,
  renderDocument,
  validateDocument,
} from "../src/content/document.ts";

describe("writing documents", () => {
  test("renders the supported editor structure without trusting text or attrs", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            {
              type: "text",
              text: "<script>x</script>",
              marks: [{ type: "bold" }],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            src: "/media/post/asset",
            alt: '" onerror="alert(1)',
            onerror: "alert(2)",
          },
        },
      ],
    };
    expect(renderDocument(doc)).toContain(
      "<h2><strong>&lt;script&gt;x&lt;/script&gt;</strong></h2>",
    );
    expect(renderDocument(doc)).toContain('alt="&quot; onerror=&quot;alert(1)"');
    expect(renderDocument(doc)).not.toContain("alert(2)");
    expect(imageReferences(doc)).toEqual([{ postId: "post", assetId: "asset" }]);
    expect(renderDocument(doc, (ref) => `/preview/${ref.assetId}`)).toContain(
      'src="/preview/asset"',
    );
  });
  test("rejects scripts, unsafe links, external images and invalid structure", () => {
    for (const child of [
      { type: "script" },
      { type: "image", attrs: { src: "https://example.com/a.png" } },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "click",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "image", attrs: { src: "/media/p/a" } }],
      },
    ])
      expect(() => validateDocument({ type: "doc", content: [child] })).toThrow();
  });
  test("retains formatting and rejects deeply nested hostile input", () => {
    expect(renderDocument(emptyDocument())).toBe("<p></p>");
    expect(
      renderDocument({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 2 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "One" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe('<ol start="2"><li><p>One</p></li></ol>');
    let node: unknown = { type: "paragraph" };
    for (let i = 0; i < 40; i++) node = { type: "blockquote", content: [node] };
    expect(() => validateDocument({ type: "doc", content: [node] })).toThrow();
  });
});
