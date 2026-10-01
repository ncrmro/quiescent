import { expect, test } from "bun:test";
import { type LfsStorage, lfsObject, parseLfsPointer } from "@quiescent/git";
import { createDocumentService } from "../src/document-service.ts";
import { localR2Media, type MediaBucket } from "../src/media.ts";
import { fixture } from "./forge-fixture.ts";

function setup() {
  const f = fixture();
  const delivered = new Map<string, { bytes: ArrayBuffer; type: string }>();
  const objects = new Map<string, ArrayBuffer>();
  const bucket: MediaBucket = {
    async get(key) {
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
  return { ...f, service, media, lfs, objects, delivered };
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
  const saved = await service.saveDraft({
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
  const edit = await service.getDraft(saved.document.id);
  const renamed = await service.saveDraft({
    ...selection(edit),
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
    service.saveDraft({
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
