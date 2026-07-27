import { expect, test } from "@playwright/test";

/**
 * The Astro wiki demo: @quiescent/wiki resolving [[wikilinks]] at build time,
 * plus the tag index, client-side search, and the note graph it derives.
 */

test("notes are grouped by type and wikilinks navigate", async ({ page }) => {
  await page.goto("/demo/wiki");
  await expect(page.getByRole("heading", { name: "concept", exact: true })).toBeVisible();

  await page.getByTestId("note-link").filter({ hasText: "Nutrient Film Technique" }).click();
  await expect(page.getByTestId("note-title")).toHaveText("Nutrient Film Technique");

  // A resolved [[wikilink]] is a real link to the note's route.
  const link = page.getByTestId("note-body").getByRole("link", { name: "Hydroponics" }).first();
  await expect(link).toHaveAttribute("href", "/demo/wiki/concepts/hydroponics");
  await link.click();
  await expect(page.getByTestId("note-title")).toHaveText("Hydroponics");
});

test("an unresolved wikilink renders as a dead marker, not raw brackets", async ({ page }) => {
  await page.goto("/demo/wiki/concepts/hydroponics");
  const body = page.getByTestId("note-body");
  await expect(body).not.toContainText("[[");
  const dead = body.locator(".wikilink--dead");
  await expect(dead).toHaveText("Does Not Exist");
  await expect(dead).toHaveAttribute("title", /unresolved/);
});

test("search finds notes by body text and title", async ({ page }) => {
  await page.goto("/demo/wiki/search");
  const results = page.getByTestId("search-results");
  await expect(results).toHaveAttribute("data-ready", "true");

  // Body-text hit: the phrase only appears inside Root Zone Temperature.
  await page.getByTestId("search-input").fill("chiller");
  await expect(page.getByTestId("search-hit")).toHaveCount(1);
  await expect(page.getByTestId("search-hit").first()).toContainText("Root Zone Temperature");

  // Prefix matching, then navigate to a hit.
  await page.getByTestId("search-input").fill("hydrop");
  await expect(page.getByTestId("search-hit").first()).toContainText("Hydroponics");
  await page.getByTestId("search-hit").first().getByRole("link").click();
  await expect(page.getByTestId("note-title")).toHaveText("Hydroponics");
});

test("tags are browsable by namespace", async ({ page }) => {
  await page.goto("/demo/wiki/tags");
  await expect(page.getByRole("heading", { name: "system", exact: true })).toBeVisible();

  await page.getByTestId("tag-link").filter({ hasText: "system/hydroponics" }).click();
  await expect(page.getByTestId("tag-title")).toHaveText("#system/hydroponics");

  const tagged = page.getByTestId("tagged-notes").getByRole("link");
  await expect(tagged).toContainText(["Hydroponics", "Nutrient Film Technique", "Veggie"]);
});

test("the graph renders notes and gains tag nodes when toggled", async ({ page }) => {
  await page.goto("/demo/wiki/graph");
  const graph = page.getByTestId("graph");
  await expect(graph).toHaveAttribute("data-ready", "true");
  await expect(graph.locator("canvas")).toBeVisible();

  const noteNodes = Number(await graph.getAttribute("data-nodes"));
  expect(noteNodes).toBeGreaterThan(5);

  await page.getByTestId("toggle-tags").check();
  await expect
    .poll(async () => Number(await graph.getAttribute("data-nodes")))
    .toBeGreaterThan(noteNodes);
});

test("editing a note leaves a draft banner, since content is baked at build", async ({ page }) => {
  await page.goto("/demo/wiki/problems/water-recovery");
  await page.getByTestId("edit-note").click();

  const editor = page.getByTestId("editor").locator(".cm-content");
  await expect(editor).toContainText("How to recover water");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nPending note edit.");
  await expect(page.getByTestId("status")).toHaveText("draft saved");

  // The note page still serves the built content, but says an edit is pending.
  await page.goto("/demo/wiki/problems/water-recovery");
  await expect(page.getByTestId("draft-banner")).toContainText("unflushed draft");
});
