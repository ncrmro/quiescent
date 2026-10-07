import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { sqliteDocumentCache } from "../../server/src/document-cache-sqlite.ts";
import { createDocumentHandler } from "../../server/src/document-http.ts";
import { createDocumentService } from "../../server/src/document-service.ts";
import { localR2Media } from "../../server/src/media.ts";
import { fixture } from "../../server/test/forge-fixture.ts";
import { type Collection, collectionSchema } from "../src/writing/collections.ts";

const writingModuleUrl = `/@fs${fileURLToPath(
  new URL("../../editor/src/writing.ts", import.meta.url),
)}`;

async function mockDocuments(page: Page, collection: Collection) {
  const backend = fixture();
  const storage = sqliteDocumentCache({ url: "file::memory:" });
  page.on("close", () => storage.close());
  const media = localR2Media({
    get: async () => null,
    put: async () => {
      throw new Error("This scenario does not upload media");
    },
  });
  const service = createDocumentService({
    cache: { storage, key: collection },
    media,
    references: () => [],
    lfs: {
      upload: async () => {
        throw new Error("No uploads in this fixture");
      },
      download: async () => {
        throw new Error("No downloads in this fixture");
      },
    },
    forge: backend.forge,
    author: { name: "Writer", email: "test@example.test" },
    collection,
    schema: collectionSchema(collection),
  });
  const handler = createDocumentHandler({
    store: service,
    apiBase: `/api/documents/${collection}`,
    authorize: () => true,
    media,
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
  await page.route(`/api/tags/${collection}`, (route) =>
    route.fulfill({ json: ["weekend", "family", "gardening"] }),
  );
  return { backend, service };
}

for (const collection of ["posts", "recipes"] as const) {
  test(`${collection} atomically saves metadata and Markdown`, async ({ page }) => {
    const { backend, service } = await mockDocuments(page, collection);
    await page.goto("/write");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/write$/);
    await expect(page.getByRole("textbox", { name: "Document body" })).toHaveCount(0);
    if (collection === "recipes") {
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await toggle.click();
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();
    }
    await page
      .locator(`[data-collection="${collection}"]`)
      .getByRole("link", {
        name: collection === "posts" ? "New post" : "New recipe",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${collection}/new$`));
    await expect(page.getByRole("status")).toContainText("Saved locally");
    expect(await service.listDocuments()).toEqual([]);
    await expect(page.getByRole("textbox", { name: "Document body" })).toBeVisible();
    expect(
      (await page.getByRole("textbox", { name: "Document body" }).boundingBox())!.y,
    ).toBeLessThan(220);
    const localId = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.startsWith("quiescent-local:"))!;
      return JSON.parse(localStorage.getItem(key)!).id as string;
    });
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("");
    await page.getByLabel("Title", { exact: true }).fill("Café & Family Weekend!");
    expect(await page.getByLabel("Slug", { exact: true }).inputValue()).toBe("");
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("cafe-family-weekend");
    await page.getByLabel("Title", { exact: true }).fill("A quiet afternoon");
    await page.waitForTimeout(600);
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("cafe-family-weekend");
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page
      .getByRole("button", {
        name: collection === "posts" ? "Post details" : "Recipe details",
        exact: true,
      })
      .click();
    await expect(page.locator("[data-header-preview]")).toBeHidden();
    await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("A quiet afternoon!");
    await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("quiet-afternoon");
    await page.getByLabel("Title", { exact: true }).fill("A quiet afternoon");
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page
      .getByRole("button", {
        name: collection === "posts" ? "Post details" : "Recipe details",
        exact: true,
      })
      .click();
    await page.getByLabel("Tags", { exact: true }).fill("wee");
    await page.getByRole("button", { name: "Add tag weekend", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove tag weekend" })).toBeVisible();
    await page.getByLabel("Tags", { exact: true }).fill("family");
    await page.getByLabel("Tags", { exact: true }).press("Enter");
    await page.getByLabel("Tags", { exact: true }).fill("FAMILY");
    await page.getByRole("button", { name: "Add tag", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove tag family", exact: true })).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: "Add tag gardening", exact: true }).click();
    await page.getByRole("button", { name: "Remove tag gardening", exact: true }).click();
    if (collection === "recipes")
      await page
        .getByLabel("Ingredients", { exact: true })
        .fill(JSON.stringify([{ name: "Tomato", quantity: "2" }]));
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const headerBefore = await page.locator(".editor-header").boundingBox();
    const bodyBefore = await page.getByRole("textbox", { name: "Document body" }).boundingBox();
    await page.getByRole("textbox", { name: "Document body" }).fill("We walked beside the river.");
    if (collection === "recipes") {
      await expect(page.getByRole("button", { name: "Finish writing", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      expect((await page.locator(".editor-header").boundingBox())!.height).toBe(48);
      expect((await page.locator(".editor-header").boundingBox())!.height).toBe(
        headerBefore!.height,
      );
      expect((await page.getByRole("textbox", { name: "Document body" }).boundingBox())!.y).toBe(
        bodyBefore!.y,
      );
      const toolbar = (await page.locator(".writing-toolbar").boundingBox())!;
      expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(48);
    }
    await page.getByRole("textbox", { name: "Document body" }).press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await expect(page.locator(".tiptap strong")).toHaveText("We walked beside the river.");
    await page.getByRole("button", { name: "Bold", exact: true }).click();
    await page.getByRole("button", { name: "More formatting", exact: true }).click();
    await expect(page.getByRole("button", { name: "Numbered list", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove image", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    if (collection === "recipes") {
      await page.getByRole("button", { name: "Finish writing", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Bold", exact: true })).toHaveCount(0);
      await page.getByLabel("Title", { exact: true }).focus();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    }
    await page.waitForTimeout(1000);
    expect(await service.listDocuments()).toEqual([]);
    await page.reload();

    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("A quiet afternoon");
    await expect(page.getByRole("textbox", { name: "Document body" })).toHaveText(
      "We walked beside the river.",
    );
    const editor = await page.getByRole("textbox", { name: "Document body" }).elementHandle();
    const geometry = () =>
      page.locator("[data-editor-content]").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
      });
    const beforeSave = await geometry();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await expect(page).toHaveURL(new RegExp(`/${collection}/${localId}/edit$`));
    expect(await editor!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await geometry()).toEqual(beforeSave);
    const saved = (await service.listDocuments())[0]!;
    expect(saved.document.frontmatter.tags).toEqual(["weekend", "family"]);
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page
      .getByRole("button", {
        name: collection === "posts" ? "Post details" : "Recipe details",
        exact: true,
      })
      .click();
    await page.getByLabel("Tags", { exact: true }).fill("unfinished");
    await page.waitForTimeout(1000);
    expect((await service.openDocument(saved.document.id)).document.frontmatter.tags).toEqual([
      "weekend",
      "family",
    ]);
    await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("unfinished");
    await page.getByLabel("Tags", { exact: true }).fill("");
    if (collection === "recipes")
      expect(saved.document.frontmatter.ingredients).toEqual([{ name: "Tomato", quantity: "2" }]);
    expect(saved.document.id).toBe(localId);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith("quiescent-local:")),
      ),
    ).toEqual([]);
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("A quiet afternoon");
    const head = saved.headSha;
    const { directory } = await service.location(saved.document.id, head);
    const markdown = backend.commits.get(head)!.files[`${directory}/index.md`];
    expect(markdown).toContain("title: A quiet afternoon");
    expect(markdown).toContain("slug: quiet-afternoon");
    expect(markdown).toContain("- family");
    expect(markdown).toContain("We walked beside the river.");
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page
      .getByRole("button", {
        name: collection === "posts" ? "Post details" : "Recipe details",
        exact: true,
      })
      .click();
    await page.getByLabel("Slug", { exact: true }).fill("invalid slug!");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByLabel("Slug", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect((await service.openDocument(saved.document.id)).headSha).toBe(head);
    await page.getByLabel("Slug", { exact: true }).fill("quiet-afternoon");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-preview-area]")).toContainText("We walked beside the river.");
    await page.getByRole("button", { name: "Back to writing", exact: true }).click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Ready to publish?" })).toBeVisible();
    await expect(page.locator("[data-review-title]")).toHaveText("A quiet afternoon");
    expect(await service.getPublished(saved.document.id)).toBeNull();
    await page.route(`/${collection}/quiet-afternoon`, (route) =>
      route.fulfill({
        body: "Published",
        headers: { "X-Quiescent-Revision": backend.branches.get("main")! },
      }),
    );
    await page
      .getByRole("dialog", { name: "Ready to publish?" })
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Published");
    expect((await service.getPublished(saved.document.id))!.document.frontmatter.tags).toEqual([
      "weekend",
      "family",
    ]);
    const commitsAfterPublish = backend.commits.size;
    const branchesAfterPublish = backend.branches.size;
    await page.getByRole("button", { name: "Edit document", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await expect(page.getByRole("textbox", { name: "Document body" })).toHaveText(
      "We walked beside the river.",
    );
    expect(backend.commits.size).toBe(commitsAfterPublish);
    expect(backend.branches.size).toBe(branchesAfterPublish);
    const firstSave = page.waitForRequest(
      (request) => request.method() === "PUT" && request.url().endsWith(`/${saved.document.id}`),
    );
    await page
      .getByRole("textbox", { name: "Document body" })
      .fill("A private revision after opening.");
    expect((await firstSave).postDataJSON().branch).toBeNull();
    await expect(page.getByRole("status")).toHaveText("Saved");
    expect(backend.branches.size).toBe(branchesAfterPublish + 1);
    expect((await service.getPublished(saved.document.id))!.document.body).toBe(
      saved.document.body,
    );
    expect((await service.openDocument(saved.document.id)).document.body).toContain(
      "A private revision after opening.",
    );
    if (collection === "recipes")
      await page.getByRole("button", { name: "Finish writing", exact: true }).click();
    const branchesBefore = [...backend.branches.keys()];
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    await page
      .getByRole("link", {
        name: collection === "posts" ? "New post" : "New recipe",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText("Saved locally");
    const longTitle =
      "A long story title about a quiet afternoon spent walking through the garden and watching the birds";
    await page.getByLabel("Title", { exact: true }).fill(longTitle);
    expect(
      await page
        .getByLabel("Title", { exact: true })
        .evaluate((input) => input.scrollHeight <= input.clientHeight),
    ).toBe(true);
    await page.getByRole("button", { name: "Editor options", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", {
        name: collection === "posts" ? "Delete post" : "Delete recipe",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/write$/);
    await expect(page.getByRole("textbox", { name: "Document body" })).toHaveCount(0);
    expect([...backend.branches.keys()]).toEqual(branchesBefore);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith("quiescent-local:")),
      ),
    ).toEqual([]);
  });
}

test("theme follows the system and remembers an override on mobile", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(theme).toHaveValue("system");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(23, 28, 25)");
  await theme.selectOption("light");
  await page.reload();
  await expect(theme).toHaveValue("light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 249, 246)");
  await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileTheme = page.getByRole("dialog").getByRole("combobox", { name: "Theme" });
  await expect(mobileTheme).toHaveValue("light");
  await mobileTheme.selectOption("dark");
  await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgb(23, 28, 25)");
  await mobileTheme.selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 249, 246)");
  expect(await page.evaluate(() => localStorage.getItem("quiescent-theme"))).toBeNull();
});

test("a restored local draft derives its missing slug on first save", async ({ page }) => {
  const { service } = await mockDocuments(page, "posts");
  await page.goto("/login");
  await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/write$/);
  await page.goto("/posts/new");
  await expect(page.getByRole("status")).toHaveText("Saved locally");
  // Restore the state left when a tab closes before title derivation runs.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("quiescent-local:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.frontmatter.title = "A restored story";
    draft.frontmatter.slug = "";
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("A restored story");
  await expect(page.getByLabel("Slug", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect((await service.listDocuments())[0]!.document.frontmatter.slug).toBe("a-restored-story");
});

test("cached listing shows freshness and searches without another request", async ({ page }) => {
  const { service } = await mockDocuments(page, "posts");
  await service.createDocument({
    frontmatter: {
      title: "Garden afternoon",
      slug: "garden-afternoon",
      description: "Picking herbs",
      tags: ["plants"],
      headerImage: null,
    },
    body: "Fresh mint",
  });
  await service.createDocument({
    frontmatter: {
      title: "A good dinner",
      slug: "a-good-dinner",
      description: "Soup at home",
      tags: ["food"],
      headerImage: null,
    },
    body: "Carrots",
  });
  await page.goto("/login");
  await page.getByLabel("Password", { exact: true }).fill("quiescent-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const section = page.locator('[data-collection="posts"]');
  await expect(section.locator("li")).toHaveCount(2);
  await expect(section.locator("[data-cache-status]")).toContainText("Last GitHub fetch:");
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/documents/posts")) calls++;
  });
  await section.getByRole("searchbox").fill("plants");
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section.locator("li")).toContainText("Garden afternoon");
  expect(calls).toBe(0);
  await section.getByRole("button", { name: "Refresh from GitHub" }).click();
  await expect(section.getByRole("button", { name: "Refresh from GitHub" })).toBeEnabled();
  expect(calls).toBe(1);
});

async function mountDictationFixture(page: Page, body = "Before", unavailable = false) {
  const savedBodies: string[] = [];
  const draft = {
    document: {
      id: "dictation-document",
      createdAt: "2026-10-07",
      frontmatter: { title: "Dictation" },
      body,
    },
    branch: "draft/dictation-document",
    headSha: "initial",
    state: "draft",
  };
  await page.route("**/dictation-api/schema", (route) =>
    route.fulfill({
      json: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", title: "Title" } },
      },
    }),
  );
  await page.route("**/dictation-api/dictation-document", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      savedBodies.push(payload.document.body);
      await route.fulfill({
        json: { ...draft, document: payload.document, headSha: `saved-${savedBodies.length}` },
      });
      return;
    }
    await route.fulfill({ json: draft });
  });
  await page.goto("/login");
  await page.locator("body").evaluate((body) => body.replaceChildren());
  await page.evaluate(
    async ({ moduleUrl, unavailable }) => {
      const { mountDocumentApp }: typeof import("../../editor/src/writing.ts") = await import(
        moduleUrl
      );
      document.body.innerHTML = '<div id="dictation-editor"></div>';
      const root = document.getElementById("dictation-editor")!;
      const recognition = {
        continuous: false,
        interimResults: false,
        lang: "",
        processLocally: false,
        onend: null,
        onerror: null,
        onresult: null,
        start() {},
        stop() {},
        abort() {},
      };
      Object.assign(window, { testRecognition: recognition });
      mountDocumentApp(root, {
        apiBase: "/dictation-api",
        initialDocumentId: "dictation-document",
        initialDocument: () => ({ frontmatter: { title: "" }, body: "" }),
        documentPath: () => "/read",
        layout: (root, host) => {
          // Exercise a host moving the textarea away from the default layout.
          root.insertBefore(host.slots.markdown, root.firstChild);
          root.appendChild(host.slots.status);
          return undefined;
        },
        onState: (state) => {
          root.dataset.phase = state.phase;
        },
        localDictation: {
          lang: "en-US",
          provider: {
            available: async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return unavailable ? "unavailable" : "available";
            },
            install: async () => true,
            create: () => recognition,
          },
        },
      });
    },
    { moduleUrl: writingModuleUrl, unavailable },
  );
  return savedBodies;
}

test("mocked local dictation availability preserves recovery and save status", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    localStorage.setItem(
      "quiescent-writing:/dictation-api:dictation-document:old",
      JSON.stringify({
        document: { frontmatter: { title: "Recovered" }, body: "Recovered body" },
        updatedAt: Date.now(),
      }),
    );
  });
  page.on("dialog", (dialog) => dialog.accept());
  const savedBodies = await mountDictationFixture(page, "Before", true);
  await expect(
    page.getByRole("button", { name: "Dictation unavailable", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("[data-dictation-interim]")).toContainText("unavailable");
  await expect(page.locator("#dictation-editor")).toHaveAttribute("data-phase", "notice");
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Recovered unsaved writing");
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect.poll(() => savedBodies.at(-1)).toBe("Recovered body");
  await expect(page.getByRole("status")).toHaveText("Saved");
});

test("mocked local dictation Markdown explanation persists beside a moved textarea", async ({
  page,
}) => {
  await mountDictationFixture(page, "<table><tr><td>verbatim</td></tr></table>");
  await expect(page.getByRole("textbox", { name: "Markdown body" })).toBeVisible();
  await expect(page.locator("[data-dictation-notice]")).toBeVisible();
  await expect(page.locator("[data-dictation-notice]")).toContainText("verbatim Markdown mode");
  await page.getByRole("textbox", { name: "Markdown body" }).fill("Edited **Markdown**");
  await expect(page.locator("[role=status]")).toHaveText("Saved");
  await expect(page.locator("[data-dictation-notice]")).toBeVisible();
});

for (const activation of ["keyboard", "programmatic"] as const) {
  test(`mocked local dictation ${activation} replaces selection, drains Stop, undoes and autosaves`, async ({
    page,
  }) => {
    const savedBodies = await mountDictationFixture(page);
    const body = page.getByRole("textbox", { name: "Document body" });
    await expect(body).toBeVisible();
    await expect(page.getByRole("button", { name: "Dictate" })).toBeEnabled();
    await body.press("ControlOrMeta+a");
    if (activation === "keyboard") {
      await page.getByRole("button", { name: "Dictate" }).focus();
      await page.keyboard.press("Enter");
    } else {
      await page
        .getByRole("button", { name: "Dictate" })
        .evaluate((button) => (button as HTMLButtonElement).click());
    }
    await expect(page.getByRole("button", { name: "Stop dictation", exact: true })).toBeEnabled();
    await page.evaluate(() => {
      const recognition = (
        window as typeof window & {
          testRecognition: { onresult: ((event: unknown) => void) | null };
        }
      ).testRecognition;
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ transcript: "<b>spoken</b>", final: true }],
      });
    });
    await expect(body).toHaveText("<b>spoken</b>");
    // Moving the caret before Stop must not reset the session's insertion target.
    await body.press("Home");
    await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Stopping dictation…", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => {
      const recognition = (
        window as typeof window & {
          testRecognition: {
            onresult: ((event: unknown) => void) | null;
            onend: (() => void) | null;
          };
        }
      ).testRecognition;
      const results = [
        { transcript: "<b>spoken</b>", final: true },
        { transcript: " tail", final: true },
      ];
      recognition.onresult?.({ resultIndex: 1, results });
      recognition.onresult?.({ resultIndex: 0, results });
      recognition.onend?.();
    });
    await expect(body).toHaveText("<b>spoken</b> tail");
    await expect(body.locator("p")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
    await expect(page.locator(".tiptap b")).toHaveCount(0);
    await expect.poll(() => savedBodies.at(-1)).toBe("&lt;b&gt;spoken&lt;/b&gt; tail");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(body).not.toContainText(" tail");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(body).toHaveText("Before");
    await expect.poll(() => savedBodies.at(-1)).toBe("Before");
  });
}
