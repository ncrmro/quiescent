import { expect, test } from "@playwright/test";

/**
 * The Astro blog demo: posts live in a content directory, are edited in the
 * browser, and land back as commits through the real flush path.
 */

test("lists posts from the forge and renders one", async ({ page }) => {
  await page.goto("/demo/blog");

  const links = page.getByTestId("post-link");
  await expect(links).toHaveCount(3);
  // Newest first.
  await expect(links.first()).toHaveText("Two ways to land an edit");

  await links.first().click();
  await expect(page.getByTestId("post-title")).toHaveText("Two ways to land an edit");
  await expect(page.getByTestId("post-body")).toContainText("notes mode");
});

test("an edit becomes a draft, then a commit visible on the post", async ({ page }) => {
  await page.goto("/demo/blog");
  await page.getByTestId("post-link").filter({ hasText: "Drafts survive" }).click();
  await page.getByTestId("edit-post").click();

  await expect(page.getByTestId("status")).toHaveText("loaded");
  const editor = page.getByTestId("editor").locator(".cm-content");
  await expect(editor).toContainText("A draft is not a commit");

  // Typing updates the preview and debounce-saves a draft.
  const marker = "Edited by a Playwright run.";
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(`\n\n${marker}`);
  await expect(page.getByTestId("preview")).toContainText(marker);
  await expect(page.getByTestId("status")).toHaveText("draft saved");

  // Commit, and confirm the stubbed forge really took it.
  await page.getByTestId("commit").click();
  await expect(page.getByTestId("status")).toContainText("committed");

  await page.goto("/demo/blog/2026-02-03-drafts-survive-the-tab-closing");
  await expect(page.getByTestId("post-body")).toContainText(marker);
});

test("going idle flushes without pressing commit", async ({ page }) => {
  await page.goto("/demo/blog/edit/content/blog/2026-01-12-editing-markdown-in-the-browser.md");

  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nLeft alone on purpose.");
  await expect(page.getByTestId("status")).toHaveText("draft saved");

  // The demo uses a 3s idle window (production defaults to 30s).
  await expect(page.getByTestId("status")).toContainText("committed", { timeout: 15_000 });
});

test("an unflushed draft is restored when the editor reopens", async ({ page }) => {
  const path = "/demo/blog/edit/content/blog/2026-02-20-two-ways-to-land-an-edit.md";
  await page.goto(path);

  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nStill a draft.");
  await expect(page.getByTestId("status")).toHaveText("draft saved");

  // Reload before the idle flush fires; the draft, not the committed file, wins.
  await page.goto(path);
  await expect(page.getByTestId("status")).toHaveText("unflushed draft restored");
  await expect(page.getByTestId("editor").locator(".cm-content")).toContainText("Still a draft.");
});
