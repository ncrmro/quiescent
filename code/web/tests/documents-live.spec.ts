import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { DocumentDraft } from "@quiescent/server/documents";
import { type ExampleMetadata, initialDocument } from "../src/writing/collections";

for (const collection of ["posts", "recipes"] as const) {
  test(`${collection} publishes images, renames cached pages and deletes`, async ({
    page,
    browser,
    baseURL,
  }) => {
    test.skip(process.env.QUIESCENT_LIVE_TEST !== "1" || !process.env.EXAMPLE_IMAGE);
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post("/api/auth/login", {
          headers,
          data: { password: "quiescent-demo" },
        })
      ).ok(),
    ).toBe(true);
    const api = `/api/documents/${collection}`;
    const create = await page.request.post(api, { headers, data: initialDocument(collection) });
    expect(create.status()).toBe(201);
    let draft = (await create.json()) as DocumentDraft<ExampleMetadata>;
    const id = draft.document.id;
    const bytes = await readFile(process.env.EXAMPLE_IMAGE!);
    const ticketResponse = await page.request.post(`${api}/${id}/uploads`, {
      headers,
      data: { contentType: "image/png", size: bytes.length },
    });
    expect(ticketResponse.ok()).toBe(true);
    const ticket = await ticketResponse.json();
    expect(
      (
        await page.request.put(ticket.url, {
          headers: { ...headers, ...ticket.headers },
          data: bytes,
        })
      ).ok(),
    ).toBe(true);
    const confirmed = await page.request.post(`${api}/${id}/uploads/${ticket.assetId}/confirm`, {
      headers,
      data: { filename: "garden.png" },
    });
    expect(confirmed.ok()).toBe(true);
    const { src } = await confirmed.json();
    expect(src).toMatch(/\.png$/);
    expect(src).not.toContain("/");
    const anonymous = await browser.newContext({ baseURL: baseURL! });
    expect((await anonymous.request.get(`/media/${id}/${src}`)).status()).toBe(404);
    const slug = `garden-${Date.now()}`;
    const selection = () => ({ branch: draft.branch, expectedHeadSha: draft.headSha });
    const save = await page.request.put(`${api}/${id}`, {
      headers,
      data: {
        ...selection(),
        document: {
          frontmatter: {
            ...draft.document.frontmatter,
            title: "A slow morning in the garden",
            slug,
            headerImage: src,
          },
          body: `A quiet morning.\n\n![Watercolor garden](${src})`,
        },
      },
    });
    expect(save.ok()).toBe(true);
    draft = await save.json();
    expect(draft.document.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const publish = await page.request.post(`${api}/${id}/publish`, { headers, data: selection() });
    expect(publish.ok()).toBe(true);
    expect((await publish.json()).cacheWarning).toBeUndefined();
    const path = `/${collection}/${slug}`;
    const warm = await anonymous.request.get(path);
    expect(warm.ok()).toBe(true);
    const warmAgain = await anonymous.request.get(path);
    expect(warmAgain.headers()["x-quiescent-rendered"]).toBe(
      warm.headers()["x-quiescent-rendered"],
    );
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "A slow morning in the garden" })).toBeVisible();
    const header = page.locator("img.header-image");
    await expect
      .poll(() => header.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    const optimized = await page.request.get(
      await header.evaluate((image: HTMLImageElement) => image.currentSrc),
    );
    expect(optimized.headers()["content-type"]).toBe("image/webp");
    expect((await optimized.body()).length).toBeLessThan(bytes.length / 2);
    if (collection === "recipes")
      await expect(page.getByAltText("Watercolor garden")).toHaveAttribute(
        "src",
        new RegExp(`^/media/${id}/`),
      );
    draft = await (await page.request.get(`${api}/${id}`)).json();
    const rename = await page.request.put(`${api}/${id}`, {
      headers,
      data: {
        ...selection(),
        document: {
          ...draft.document,
          frontmatter: { ...draft.document.frontmatter, slug: `${slug}-updated` },
        },
      },
    });
    expect(rename.ok()).toBe(true);
    draft = await rename.json();
    expect((await anonymous.request.get(path)).ok()).toBe(true);
    const republished = await page.request.post(`${api}/${id}/publish`, {
      headers,
      data: selection(),
    });
    expect(republished.ok()).toBe(true);
    const result = await republished.json();
    expect(result.cacheWarning).toBeUndefined();
    expect((await anonymous.request.get(path)).status()).toBe(404);
    expect((await anonymous.request.get(`${path}-updated`)).ok()).toBe(true);
    const deleted = await page.request.delete(`${api}/${id}`, {
      headers,
      data: { expectedHeadSha: result.publishedSha },
    });
    expect(deleted.ok()).toBe(true);
    expect((await deleted.json()).cacheWarning).toBeUndefined();
    expect((await anonymous.request.get(`${path}-updated`)).status()).toBe(404);
    expect((await anonymous.request.get(`/media/${id}/${src}`)).status()).toBe(404);
    await anonymous.close();
  });
}
