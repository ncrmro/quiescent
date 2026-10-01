import { expect, test } from "@playwright/test";
import { createDocumentHandler } from "../../server/src/document-http.ts";
import { createDocumentStore } from "../../server/src/document-store.ts";
import { localR2Media } from "../../server/src/media.ts";
import { fixture } from "../../server/test/forge-fixture.ts";
import { collectionSchema } from "../src/writing/collections.ts";

for (const collection of ["posts", "recipes"] as const) {
  test(`${collection} atomically saves metadata and Markdown`, async ({ page }) => {
    const backend = fixture();
    const service = createDocumentStore({
      forge: backend.forge,
      author: { name: "Writer", email: "test@example.test" },
      collection,
      schema: collectionSchema(collection),
    });
    const handler = createDocumentHandler({
      store: service,
      apiBase: `/api/documents/${collection}`,
      authorize: () => true,
      media: localR2Media({
        get: async () => null,
        put: async () => {
          throw new Error("This scenario does not upload media");
        },
      }),
    });
    await page.route(new RegExp(`/api/documents/${collection}(?:/|$)`), async (route) => {
      const incoming = route.request();
      const body = incoming.postData();
      const response = await handler(
        new Request(incoming.url(), {
          method: incoming.method(),
          headers: incoming.headers(),
          ...(body ? { body } : {}),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    await page.goto("/write");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/write$/);
    if (collection === "recipes") await page.goto("/recipes/new");
    await page
      .getByRole("button", {
        name: collection === "posts" ? "New post" : "New recipe",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.getByLabel("Title", { exact: true }).fill("A quiet afternoon");
    await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
    await page.getByLabel("Tags", { exact: true }).fill("weekend, family");
    if (collection === "recipes")
      await page
        .getByLabel("Ingredients", { exact: true })
        .fill(JSON.stringify([{ name: "Tomato", quantity: "2" }]));
    await page.getByRole("textbox", { name: "Document body" }).fill("We walked beside the river.");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    const saved = (await service.listDocuments())[0]!;
    if (collection === "recipes")
      expect(saved.document.frontmatter.ingredients).toEqual([{ name: "Tomato", quantity: "2" }]);
    const head = saved.headSha;
    const { directory } = await service.location(saved.document.id, head);
    const markdown = backend.commits.get(head)!.files[`${directory}/index.md`];
    expect(markdown).toContain("title: A quiet afternoon");
    expect(markdown).toContain("slug: quiet-afternoon");
    expect(markdown).toContain("- family");
    expect(markdown).toContain("We walked beside the river.");
    await page.getByLabel("Slug", { exact: true }).fill("invalid slug!");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByLabel("Slug", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect((await service.getDraft(saved.document.id)).headSha).toBe(head);
    await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-preview-area]")).toContainText("We walked beside the river.");
  });
}
