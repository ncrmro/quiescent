import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);
const api = "/api/writing";

test.describe("GitHub writing acceptance with configured media", () => {
  test.skip(process.env.QUIESCENT_LIVE_TEST !== "1", "Explicit live opt-in and configured GitHub/media backend required");

  test("writes, reopens, isolates images, publishes and privately revises", async ({ page, context }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const firstTitle = `Sunday at the farmers market ${suffix}`;
    const secondTitle = `An unfinished seaside memory ${suffix}`;
    const firstBody = "We bought peaches and shared a quiet breakfast beneath the trees.";
    const revisedBody = "We returned the next morning for flowers and warm bread.";
    const forbiddenAuth: boolean[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith(api)) {
        forbiddenAuth.push(Boolean(request.headers().authorization));
      }
    });
    page.on("dialog", async dialog => {
      if (dialog.type() === "prompt") await dialog.accept("A tiny photograph from our weekend");
      else if (dialog.type() === "beforeunload") await dialog.accept();
      else await dialog.dismiss();
    });
    await page.goto("/write");
    await expect(page.getByRole("status")).toHaveText("Choose a post or start writing.");

    const save = async () => {
      await page.getByRole("button", { name: "Save now", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Saved");
    };
    const create = async (title: string, body: string) => {
      const created = page.waitForResponse(response => new URL(response.url()).pathname === `${api}/posts` && response.request().method() === "POST");
      await page.getByRole("button", { name: "New post", exact: true }).click();
      const response = await created;
      expect(response.ok()).toBe(true);
      const draft = await response.json() as { post: { id: string } };
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
      await expect(page.getByRole("status")).toHaveText("Saved");
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page.getByLabel("Description", { exact: true }).fill("A small story about an ordinary, lovely day.");
      await page.getByRole("textbox", { name: "Post body" }).fill(body);
      // Format through the public toolbar, exercising editor document persistence.
      await page.getByRole("textbox", { name: "Post body" }).press("ControlOrMeta+a");
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Post body" }).locator("strong")).toContainText(body);
      await page.getByRole("textbox", { name: "Post body" }).press("ControlOrMeta+End");
      await page.getByRole("textbox", { name: "Post body" }).press("Enter");
      await page.locator('input[type="file"]').setInputFiles({ name: "weekend.png", mimeType: "image/png", buffer: png });
      const editorImage = page.getByRole("textbox", { name: "Post body" }).getByRole("img");
      await expect(editorImage).toHaveAttribute("alt", "A tiny photograph from our weekend");
      const imageSrc = await editorImage.getAttribute("src");
      expect(imageSrc).toMatch(/^\/api\/writing\/media\//);
      await save();
      await expect(page.getByRole("navigation", { name: "Posts" }).getByRole("button", { name: `${title} — Draft`, exact: true })).toBeVisible();
      return { id: draft.post.id, imagePath: imageSrc!.replace(api, "") };
    };

    const first = await create(firstTitle, firstBody);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-preview-area] strong")).toHaveText(firstBody);
    await expect(page.locator("[data-preview-area] img")).toHaveAttribute("alt", "A tiny photograph from our weekend");
    const second = await create(secondTitle, "I have not decided how to finish this story yet.");
    expect((await page.request.get(second.imagePath)).status()).toBe(404);
    expect((await page.request.get(first.imagePath)).status()).toBe(404);

    // A fresh page after reload must recover from GitHub, with no browser-local fallback.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("navigation", { name: "Posts" }).getByRole("button", { name: `${firstTitle} — Draft`, exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(firstTitle);
    await expect(page.getByRole("textbox", { name: "Post body" }).locator("strong")).toHaveText(firstBody);
    await expect(page.getByRole("textbox", { name: "Post body" }).getByRole("img")).toHaveCount(1);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Published");
    const readerHref = await page.getByRole("link", { name: "Read your post" }).getAttribute("href");
    expect(readerHref).toContain(`/read/${first.id}/`);
    const reader = await context.newPage();
    await reader.goto(readerHref!);
    await expect(reader.getByRole("heading", { name: firstTitle, exact: true })).toBeVisible();
    await expect(reader.locator("strong")).toHaveText(firstBody);
    await expect(reader.getByRole("img")).toHaveAttribute("alt", "A tiny photograph from our weekend");
    const publicImage = await page.request.get(first.imagePath);
    expect(publicImage.ok()).toBe(true);
    expect(publicImage.headers()["content-type"]).toContain("image/png");
    expect((await page.request.get(second.imagePath)).status()).toBe(404);
    expect((await page.request.get(`${api}/published/${second.id}`)).status()).toBe(404);

    await page.getByRole("button", { name: "Edit post", exact: true }).click();
    await expect(page.getByRole("button", { name: "Publish changes", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Post body" }).fill(revisedBody);
    await save();
    await reader.reload();
    await expect(reader.locator("main")).toContainText(firstBody);
    await expect(reader.locator("main")).not.toContainText(revisedBody);
    await page.getByRole("button", { name: "Publish changes", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Published");
    await reader.reload();
    await expect(reader.locator("main")).toContainText(revisedBody);
    await expect(reader.locator("main")).not.toContainText(firstBody);
    expect((await page.request.get(second.imagePath)).status()).toBe(404);
    expect(forbiddenAuth.length).toBeGreaterThan(0);
    expect(forbiddenAuth.some(Boolean)).toBe(false);
    await reader.close();
  });

  test("retries failed uploads, waits before publishing, and preserves stale-tab writing", async ({ page, context }) => {
    const title = `A quiet afternoon in the garden ${crypto.randomUUID().slice(0, 8)}`;
    page.on("dialog", async dialog => {
      if (dialog.type() === "prompt") await dialog.accept("Sunlight in the garden");
      else if (dialog.type() === "beforeunload") await dialog.accept();
      else await dialog.dismiss();
    });
    await page.goto("/write");
    await expect(page.getByRole("status")).toHaveText("Choose a post or start writing.");
    const created = page.waitForResponse(response => new URL(response.url()).pathname === `${api}/posts` && response.request().method() === "POST");
    await page.getByRole("button", { name: "New post", exact: true }).click();
    const response = await created;
    expect(response.ok()).toBe(true);
    const { post: { id } } = await response.json() as { post: { id: string } };
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByRole("textbox", { name: "Post body" }).fill("We watched the bees visit the flowers until the afternoon cooled.");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    let attempts = 0;
    let releaseUpload!: () => void;
    let reachedUpload!: () => void;
    let releasePublish!: () => void;
    let reachedPublish!: () => void;
    const uploadHeld = new Promise<void>(resolve => { releaseUpload = resolve; });
    const uploadReached = new Promise<void>(resolve => { reachedUpload = resolve; });
    const publishHeld = new Promise<void>(resolve => { releasePublish = resolve; });
    const publishReached = new Promise<void>(resolve => { reachedPublish = resolve; });
    await page.route("**/*", async route => {
      const request = route.request();
      if (request.method() === "PUT" && request.headers()["content-type"] === "image/png") {
        attempts++;
        if (attempts === 1) return route.abort("failed");
        reachedUpload();
        await uploadHeld;
      }
      if (request.method() === "POST" && new URL(request.url()).pathname === `${api}/posts/${id}/publish`) {
        reachedPublish();
        await publishHeld;
      }
      await route.continue();
    });
    const file = { name: "garden.png", mimeType: "image/png", buffer: png };
    const uploadInput = page.locator('input[type="file"]');
    await uploadInput.setInputFiles(file);
    await expect(page.getByRole("status")).toContainText("Image upload failed.");
    await expect(page.getByRole("button", { name: "Add image", exact: true })).toBeEnabled();
    expect(attempts).toBe(1);

    // Retry the exact same file and hold its transfer while Publish is clicked.
    await uploadInput.setInputFiles(file);
    await uploadReached;
    await expect(page.getByRole("button", { name: "Add image", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    await expect(uploadInput).toBeDisabled();
    releaseUpload();
    await publishReached;
    await expect(page.getByRole("textbox", { name: "Post body" }).getByRole("img")).toHaveAttribute("alt", "Sunlight in the garden");
    // Upload completion must not unlock the editor while the merge is pending.
    await expect(page.getByRole("button", { name: "Add image", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Description", { exact: true })).toBeDisabled();
    releasePublish();
    await expect(page.getByRole("status")).toHaveText("Published");
    expect(attempts).toBe(2);
    await page.unrouteAll({ behavior: "wait" });
    const readerHref = await page.getByRole("link", { name: "Read your post" }).getAttribute("href");
    const reader = await context.newPage();
    await reader.goto(readerHref!);
    await expect(reader.getByRole("img", { name: "Sunlight in the garden", exact: true })).toHaveCount(1);
    await expect(reader.locator("main")).toContainText("We watched the bees visit the flowers until the afternoon cooled.");
    await reader.close();

    await page.getByRole("button", { name: "Edit post", exact: true }).click();
    await expect(page.getByRole("button", { name: "Publish changes", exact: true })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Description", { exact: true })).toBeEnabled();
    const other = await context.newPage();
    other.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
    await other.goto("/write");
    await other.getByRole("navigation", { name: "Posts" }).getByRole("button", { name: `${title} — Unpublished changes`, exact: true }).click();
    await expect(other.getByLabel("Title", { exact: true })).toHaveValue(title);
    await page.getByLabel("Title", { exact: true }).fill(`${title} revisited`);
    await page.getByLabel("Description", { exact: true }).fill("A fresh description from the first tab.");
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    const retained = "My second-tab thoughts must remain available after a conflict.";
    await other.getByLabel("Description", { exact: true }).fill(retained);
    await other.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("Could not save:");
    await expect(other.getByRole("status")).toContainText("newer changes");
    await expect(other.getByLabel("Description", { exact: true })).toHaveValue(retained);
    expect(await other.evaluate(({ postId, description }) => Object.entries(localStorage).some(([key, value]) => {
      if (!key.startsWith(`quiescent-writing:/api/writing:${postId}:`)) return false;
      try { return JSON.parse(value)?.post?.description === description; } catch { return false; }
    }), { postId: id, description: retained })).toBe(true);
    await other.close();
  });

});
