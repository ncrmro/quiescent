import { expect, test } from "@playwright/test";
import { localR2Media } from "../../server/src/media.ts";
import { createWritingHandler } from "../../server/src/writing-http.ts";
import { fixture } from "../../server/test/forge-fixture.ts";

test("the example signs in and atomically saves metadata and Markdown", async ({ page }) => {
  const backend = fixture();
  const service = backend.service();
  const handler = createWritingHandler({
    service,
    authorize: () => true,
    media: localR2Media({
      get: async () => null,
      put: async () => {
        throw new Error("This scenario does not upload media");
      },
    }),
  });
  await page.route("**/api/writing/**", async (route) => {
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
  await page.getByRole("button", { name: "New post", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByLabel("Title", { exact: true }).fill("A quiet afternoon");
  await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
  await page.getByLabel("Tags", { exact: true }).fill("weekend, family");
  await page.getByRole("textbox", { name: "Post body" }).fill("We walked beside the river.");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const saved = (await service.listPosts())[0]!;
  const head = saved.headSha;
  const { directory } = await service.documents.location(saved.post.id, head);
  const markdown = backend.commits.get(head)!.files[`${directory}/index.md`];
  expect(markdown).toContain("title: A quiet afternoon");
  expect(markdown).toContain("slug: quiet-afternoon");
  expect(markdown).toContain("- family");
  expect(markdown).toContain("We walked beside the river.");
  await page.getByLabel("Slug", { exact: true }).fill("invalid slug!");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByLabel("Slug", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect((await service.getDraft(saved.post.id)).headSha).toBe(head);
  await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("[data-preview-area]")).toContainText("We walked beside the river.");
});
