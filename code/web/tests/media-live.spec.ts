import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("publishes a garden story with filename-only header and body images", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.QUIESCENT_LIVE_TEST !== "1" || !process.env.EXAMPLE_IMAGE,
    "Requires an explicit live backend and example image",
  );
  const image = {
    name: "garden-morning.png",
    mimeType: "image/png",
    buffer: await readFile(process.env.EXAMPLE_IMAGE!),
  };
  await page.goto("/login");
  await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  let draft: { post: { id: string } };
  if (process.env.EXAMPLE_POST_ID) {
    await page.goto(`/posts/${process.env.EXAMPLE_POST_ID}/edit`);
    draft = { post: { id: process.env.EXAMPLE_POST_ID } };
  } else {
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/writing/posts") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "New post", exact: true }).click();
    draft = await (await created).json();
  }
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByLabel("Title", { exact: true }).fill("A slow morning in the garden");
  await page.getByLabel("Slug", { exact: true }).fill("a-slow-morning-in-the-garden");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Tea, ripe tomatoes, and a little time outside.");
  await page.getByLabel("Tags", { exact: true }).fill("garden, everyday life");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill(
      "The tomatoes were ready before I was. I took my tea outside and let the morning arrive slowly.",
    );
  await page.locator("[data-header-file]").setInputFiles(image);
  await expect(page.locator("[data-header-preview]")).toBeVisible();
  await expect(page.locator("[data-header-preview]")).toHaveJSProperty("naturalWidth", 1536);
  await page.getByRole("textbox", { name: "Post body" }).press("ControlOrMeta+End");
  await page.getByRole("textbox", { name: "Post body" }).press("Enter");
  page.on("dialog", (dialog) => dialog.accept("Tomatoes and a cup of tea in the morning sun"));
  await page.locator('[data-editor] input[type="file"]').setInputFiles(image);
  await expect(page.getByRole("textbox", { name: "Post body" }).getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const state = await (await page.request.get(`/api/writing/posts/${draft.post.id}`)).json();
  expect(state.post.headerImage).toMatch(/^garden-morning-[a-f0-9]{12}\.png$/);
  const publicPath = `/media/${draft.post.id}/${state.post.headerImage}`;
  const anonymous = await browser.newContext({
    baseURL: process.env.BASE_URL!,
    viewport: { width: 390, height: 844 },
  });
  expect((await anonymous.request.get(publicPath)).status()).toBe(404);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Published", { timeout: 120_000 });
  const reader = await anonymous.newPage();
  await reader.goto("/");
  await expect(
    reader.getByRole("link", { name: "A slow morning in the garden", exact: true }),
  ).toBeVisible();
  await reader.getByRole("link", { name: "A slow morning in the garden", exact: true }).click();
  await expect(
    reader.getByAltText("Tomatoes and a cup of tea in the morning sun"),
  ).toHaveJSProperty("naturalWidth", 1536);
  await expect(reader.locator(".header-image")).toHaveJSProperty("naturalWidth", 1536);
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  const served = await anonymous.request.get(publicPath);
  expect(served.status()).toBe(200);
  expect(await served.body()).toEqual(image.buffer);
  console.log(
    JSON.stringify({ reader: reader.url(), id: draft.post.id, image: state.post.headerImage }),
  );
  await reader.screenshot({
    path: `/tmp/quiescent-garden-${new URL(process.env.BASE_URL!).hostname}.png`,
    fullPage: true,
  });
  await anonymous.close();
});
