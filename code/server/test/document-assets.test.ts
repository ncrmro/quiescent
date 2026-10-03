import { expect, test } from "bun:test";
import { type LfsStorage, lfsObject, parseLfsPointer } from "@quiescent/git";
import { createDocumentService } from "../src/document-service.ts";
import { localR2Media, type MediaBucket } from "../src/media.ts";
import { fixture } from "./forge-fixture.ts";

function setup() {
  const f = fixture();
  const reads = { delivery: 0, lfs: 0 };
  const delivered = new Map<string, { bytes: ArrayBuffer; type: string }>();
  const objects = new Map<string, ArrayBuffer>();
  const bucket: MediaBucket = {
    async get(key) {
      reads.delivery++;
      const v = delivered.get(key);
      return v
        ? {
            arrayBuffer: async () => v.bytes.slice(0),
            size: v.bytes.byteLength,
            httpMetadata: { contentType: v.type },
          }
        : null;
    },
    async put(key, bytes, options) {
      delivered.set(key, { bytes, type: options.httpMetadata.contentType });
    },
  };
  const media = localR2Media(bucket);
  const lfs: LfsStorage = {
    async upload(bytes) {
      const object = await lfsObject(bytes);
      objects.set(object.oid, bytes);
      return object;
    },
    async download(object) {
      reads.lfs++;
      const bytes = objects.get(object.oid);
      if (!bytes) throw new Error("LFS unavailable");
      return bytes.slice(0);
    },
  };
  const service = createDocumentService<{
    title: string;
    slug: string;
    headerImage: string | null;
  }>({
    collection: "posts",
    schema: true,
    filename: (document) => `${document.createdAt}-${document.frontmatter.slug}`,
    references: (document) =>
      document.frontmatter.headerImage ? [document.frontmatter.headerImage] : [],
    forge: f.forge,
    author: { name: "Writer", email: "writer@example.test" },
    media,
    lfs,
  });
  return { ...f, service, media, lfs, objects, delivered, reads };
}
const selection = (draft: {
  document: { id: string };
  branch: string | null;
  headSha: string;
}) => ({
  id: draft.document.id,
  branch: draft.branch!,
  expectedHeadSha: draft.headSha,
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]).buffer;

test("one save commits Markdown and LFS pointers; rename preserves identity and missing delivery bytes restore from LFS", async () => {
  const { service, media, commits, delivered } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "", slug: "draft", headerImage: null },
    body: "",
  });
  const ticket = await media.prepare(draft.document.id, "image/png", png.byteLength);
  await media.uploadLocal!(
    draft.document.id,
    ticket.assetId,
    new Request("https://test/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    }),
  );
  const { src } = await media.confirm(draft.document.id, ticket.assetId, "Garden.png");
  expect(src).toMatch(/^Garden-[a-f0-9]{12}\.png$/);
  const count = commits.size;
  const saved = await service.saveDocument({
    ...selection(draft),
    document: {
      ...draft.document,
      frontmatter: { title: "A garden", slug: "garden", headerImage: src },
      body: `![Our garden](${src})`,
    },
  });
  expect(commits.size).toBe(count + 1);
  const { directory } = await service.location(saved.document.id, saved.headSha);
  expect(directory).toBe(`posts/${saved.document.createdAt!.slice(0, 10)}-garden`);
  const files = commits.get(saved.headSha)!.files;
  expect(files[`${directory}/index.md`]).toContain(`id: ${saved.document.id}`);
  expect(files[`${directory}/index.md`]).toContain(`![Our garden](${src})`);
  expect(parseLfsPointer(files[`${directory}/${src}`]!)).toEqual(await lfsObject(png));
  expect(files[`${directory}/.gitattributes`]).toContain("filter=lfs");
  expect(await service.readMedia(saved.document.id, src)).toBeNull();
  await service.publish(selection(saved));
  delivered.clear();
  expect(
    await new Response((await service.readMedia(saved.document.id, src))!.body).arrayBuffer(),
  ).toEqual(png);
  expect(delivered.size).toBe(1);
  const edit = await service.openDocument(saved.document.id);
  const renamed = await service.saveDocument({
    id: edit.document.id,
    branch: edit.branch,
    expectedHeadSha: edit.headSha,
    document: {
      ...edit.document,
      frontmatter: { ...edit.document.frontmatter, slug: "slow-morning" },
    },
  });
  expect(renamed.document.createdAt).toBe(saved.document.createdAt);
  expect(commits.get(renamed.headSha)!.files[`${directory}/index.md`]).toBeUndefined();
  await service.publish(selection(renamed));
  expect((await service.listPublished()).map((p) => p.document.frontmatter.slug)).toEqual([
    "slow-morning",
  ]);
  expect(
    await new Response((await service.readMedia(saved.document.id, src))!.body).arrayBuffer(),
  ).toEqual(png);
});

test("failed LFS upload leaves the draft revision and Markdown untouched", async () => {
  const { service, media, lfs, branches, commits } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "", slug: "draft", headerImage: null },
    body: "",
  });
  await media.restore(draft.document.id, "garden.png", png, "image/png");
  lfs.upload = async () => {
    throw new Error("LFS unavailable");
  };
  const count = commits.size;
  await expect(
    service.saveDocument({
      ...selection(draft),
      document: {
        ...draft.document,
        frontmatter: { ...draft.document.frontmatter, title: "Garden", headerImage: "garden.png" },
      },
    }),
  ).rejects.toThrow("LFS unavailable");
  expect(commits.size).toBe(count);
  expect(branches.get(draft.branch!)).toBe(draft.headSha);
});

test("renaming preserves and hydrates an original no longer referenced by the document", async () => {
  const { service, media, commits, delivered } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "Original", slug: "original", headerImage: null },
    body: "",
  });
  await media.restore(
    draft.document.id,
    "archive.gif",
    new TextEncoder().encode("GIF89a").buffer,
    "image/gif",
  );
  const saved = await service.saveDocument({
    ...selection(draft),
    document: {
      ...draft.document,
      frontmatter: { ...draft.document.frontmatter, headerImage: "archive.gif" },
    },
  });
  const old = await service.location(saved.document.id, saved.headSha);
  const pointer = commits.get(saved.headSha)!.files[`${old.directory}/archive.gif`];
  delivered.clear();
  const renamed = await service.saveDocument({
    ...selection(saved),
    document: {
      ...saved.document,
      frontmatter: { ...saved.document.frontmatter, slug: "renamed", headerImage: null },
    },
  });
  const current = await service.location(renamed.document.id, renamed.headSha);
  const files = commits.get(renamed.headSha)!.files;
  expect(files[`${current.directory}/archive.gif`]).toBe(pointer);
  expect(files[`${old.directory}/archive.gif`]).toBeUndefined();
  expect(files[`${current.directory}/.gitattributes`]).toContain("*.[gG][iI][fF] filter=lfs");
  expect(delivered.size).toBe(1);
  await service.publish(selection(renamed));
  expect(await service.readMedia(renamed.document.id, "archive.gif")).toBeNull();
});

test("private media GET serves staged uploads without creating branches and rejects retired drafts", async () => {
  const { createDocumentHandler } = await import("../src/document-http.ts");
  const { service, media, commits, branches } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "Garden", slug: "garden", headerImage: null },
    body: "",
  });
  await media.restore(draft.document.id, "garden.png", png, "image/png");
  const handler = createDocumentHandler({
    store: service,
    media,
    readMedia: service.readMedia,
    authorize: () => true,
  });
  const url = `https://test/api/documents/${draft.document.id}/media/garden.png`;
  const count = commits.size;
  expect((await handler(new Request(url))).status).toBe(200);
  expect(commits.size).toBe(count);
  const published = await service.publish(selection(draft));
  const after = commits.size;
  const branchCount = branches.size;
  expect((await handler(new Request(url))).status).toBe(200);
  expect(
    (await handler(new Request(`${url}?branch=${encodeURIComponent(draft.branch!)}`))).status,
  ).toBe(404);
  expect(await service.readMedia(draft.document.id, "garden.png", draft.branch!)).toBeNull();
  expect(commits.size).toBe(after);
  expect(branches.size).toBe(branchCount);
  expect(published.state).toBe("published");
});

test("media reads reuse the existing delivery stream and cold LFS bytes without a second read", async () => {
  const { service, media, delivered, reads } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "Garden", slug: "garden", headerImage: null },
    body: "",
  });
  await media.restore(draft.document.id, "garden.png", png, "image/png");
  const saved = await service.saveDocument({
    ...selection(draft),
    document: {
      ...draft.document,
      frontmatter: { ...draft.document.frontmatter, headerImage: "garden.png" },
    },
  });
  await service.publish(selection(saved));
  reads.delivery = 0;
  reads.lfs = 0;
  expect(
    await new Response(
      (await service.readMedia(saved.document.id, "garden.png"))!.body,
    ).arrayBuffer(),
  ).toEqual(png);
  expect(reads).toEqual({ delivery: 1, lfs: 0 });
  delivered.clear();
  reads.delivery = 0;
  expect(
    await new Response(
      (await service.readMedia(saved.document.id, "garden.png"))!.body,
    ).arrayBuffer(),
  ).toEqual(png);
  expect(reads).toEqual({ delivery: 1, lfs: 1 });
});

test("upload phases require an existing selected branch and never create document commits", async () => {
  const { createDocumentHandler } = await import("../src/document-http.ts");
  const { service, media, commits, branches } = setup();
  const draft = await service.createDocument({
    frontmatter: { title: "Garden", slug: "garden", headerImage: null },
    body: "",
  });
  const handler = createDocumentHandler({ store: service, media, authorize: () => true });
  const base = `https://test/api/documents/${draft.document.id}/uploads`;
  const request = (url: string, data: unknown) =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test" },
      body: JSON.stringify(data),
    });
  const before = { commits: commits.size, branches: branches.size };
  expect(
    (await handler(request(base, { contentType: "image/png", size: png.byteLength }))).status,
  ).toBe(409);
  const branch = `?branch=${encodeURIComponent(draft.branch!)}`;
  const prepared = await handler(
    request(base + branch, { contentType: "image/png", size: png.byteLength }),
  );
  expect(prepared.status).toBe(200);
  const ticket = (await prepared.json()) as { assetId: string; url: string };
  expect(ticket.url.startsWith("/api/documents/")).toBe(true);
  expect(new URL(ticket.url, "https://test").searchParams.get("branch")).toBe(draft.branch);
  expect(
    (
      await handler(
        new Request(new URL(ticket.url, "https://test"), {
          method: "PUT",
          headers: { "Content-Type": "image/png", Origin: "https://test" },
          body: png,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await handler(
        request(`${base}/${ticket.assetId}/confirm${branch}`, { filename: "garden.png" }),
      )
    ).status,
  ).toBe(200);
  expect({ commits: commits.size, branches: branches.size }).toEqual(before);
  await service.publish(selection(draft));
  const published = { commits: commits.size, branches: branches.size };
  expect(
    (await handler(request(base + branch, { contentType: "image/png", size: png.byteLength })))
      .status,
  ).toBe(409);
  expect({ commits: commits.size, branches: branches.size }).toEqual(published);
});
