import { expect, test } from "bun:test";
import { documentCodec } from "../src/document-codec.ts";
import {
  createDocumentStore,
  type DocumentDraft,
  DocumentError,
  type JSONSchema,
} from "../src/document-store.ts";
import { fixture } from "./forge-fixture.ts";

const author = { name: "Writer", email: "writer@example.test" };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["servings", "ingredients"],
  properties: {
    servings: { type: "integer", minimum: 1 },
    ingredients: { type: "array", items: { type: "string" }, minItems: 1 },
  },
} satisfies JSONSchema;
const initial = {
  frontmatter: { servings: 2, ingredients: ["tomatoes", "salt"] },
  body: "# Lunch\n\nMix gently.\n",
};
const selection = (draft: DocumentDraft) => ({
  id: draft.document.id,
  branch: draft.branch!,
  expectedHeadSha: draft.headSha,
});
function setup() {
  const f = fixture();
  return {
    ...f,
    store: createDocumentStore({ forge: f.forge, author, collection: "recipes", schema }),
  };
}

test("arbitrary schemas save front matter and Markdown in one commit and publish only from main", async () => {
  const { store, forge, commits, branches } = setup();
  const draft = await store.createDocument(initial);
  expect(await store.listPublished()).toEqual([]);
  const before = commits.size;
  const input = {
    frontmatter: { servings: 4, ingredients: ["peaches", "cream"] },
    body: "## Dessert\n\nServe **cold**.\n",
  };
  const saved = await store.saveDraft({ ...selection(draft), document: input });
  expect(commits.size - before).toBe(1);
  const source = commits.get(saved.headSha)!.files[`recipes/${saved.document.id}/index.md`]!;
  expect(source).toContain("servings: 4");
  expect(source).toContain("- peaches");
  expect(documentCodec(true).parse(source)).toEqual({
    ...input,
    frontmatter: {
      ...input.frontmatter,
      id: saved.document.id,
      createdAt: saved.document.createdAt,
    },
  });
  const published = await store.publish(selection(saved));
  expect((await store.getPublished(saved.document.id))?.document).toEqual(published.document);
  const edit = await store.getDraft(saved.document.id);
  await store.saveDraft({ ...selection(edit), document: { ...input, body: "Private revision" } });
  expect((await store.listPublished())[0]?.document.body).toBe(input.body);
  const other = createDocumentStore({ forge, author, collection: "other", schema });
  expect(await other.listDocuments()).toEqual([]);
  expect(branches.get("main")).toBe(published.publishedSha);
});

test("invalid metadata never creates or partially saves a document", async () => {
  const { store, commits, branches } = setup();
  await expect(
    store.createDocument({ ...initial, frontmatter: { ...initial.frontmatter, servings: 0 } }),
  ).rejects.toBeInstanceOf(DocumentError);
  expect(branches.size).toBe(1);
  expect(commits.size).toBe(1);
  const draft = await store.createDocument(initial);
  const count = commits.size;
  await expect(
    store.saveDraft({
      ...selection(draft),
      document: { frontmatter: { servings: 0, ingredients: [] }, body: "Would lose original" },
    }),
  ).rejects.toBeInstanceOf(DocumentError);
  expect(commits.size).toBe(count);
  expect(branches.get(draft.branch!)).toBe(draft.headSha);
  expect((await store.getDraft(draft.document.id, draft.branch!)).document.body).toBe(initial.body);
  commits.get(draft.headSha)!.files[`recipes/${draft.document.id}/index.md`] =
    "---\nservings: nope\ningredients: []\n---\nChanged outside Quiescent";
  const bad = draft;
  await expect(store.publish(selection(bad))).rejects.toBeInstanceOf(DocumentError);
  expect(branches.get("main")).toBe("root");
});

test("Markdown codec keeps body verbatim and rejects malformed YAML and incompatible metadata", () => {
  const codec = documentCodec(schema);
  const document = {
    ...initial,
    body: "\n<script>literal source</script>\n\n---\n\nTrailing spaces  \n",
  };
  expect(codec.parse(codec.stringify(document))).toEqual(document);
  for (const source of [
    "Missing front matter",
    "---\nservings: 2\nservings: 3\ningredients: [salt]\n---\nbody",
    "---\n- not an object\n---\nbody",
  ])
    expect(() => codec.parse(source)).toThrow(DocumentError);
  expect(() =>
    codec.stringify({ ...initial, frontmatter: { servings: NaN, ingredients: ["salt"] } }),
  ).toThrow(DocumentError);
});

test("generic HTTP saves one document and returns validation fields without mutating Git", async () => {
  const { createDocumentHandler } = await import("../src/document-http.ts");
  const { store, branches } = setup();
  const api = createDocumentHandler({
    store,
    authorize: (r) => r.headers.get("Authorization") === "test",
  });
  const request = (path: string, method = "GET", data?: unknown, origin = "https://example.test") =>
    new Request(`https://example.test/api/documents${path}`, {
      method,
      headers: { Authorization: "test", Origin: origin },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const response = await api(request("", "POST", initial));
  expect(response.status).toBe(201);
  const draft = await response.json();
  const failed = await api(
    request(`/${draft.document.id}`, "PUT", {
      ...selection(draft),
      document: { ...initial, frontmatter: { ...initial.frontmatter, servings: 0 } },
    }),
  );
  expect(failed.status).toBe(400);
  expect(await failed.json()).toMatchObject({ fields: { servings: expect.any(String) } });
  expect(branches.get(draft.branch)).toBe(draft.headSha);
  expect((await api(request(`/${draft.document.id}`, "PUT", { ...selection(draft) }))).status).toBe(
    400,
  );
  expect((await api(request("", "POST", initial, "https://other.test"))).status).toBe(403);
  expect((await api(new Request("https://example.test/api/documents"))).status).toBe(403);
  const saved = await (
    await api(
      request(`/${draft.document.id}`, "PUT", {
        ...selection(draft),
        document: { ...initial, body: "New instructions" },
      }),
    )
  ).json();
  expect(
    (await api(request(`/${draft.document.id}/publish`, "POST", selection(saved)))).status,
  ).toBe(200);
  expect((await store.getPublished(draft.document.id))?.document.body).toBe("New instructions");
});

test("readable folder collisions and reserved metadata cannot overwrite another document", async () => {
  const f = fixture();
  const store = createDocumentStore({
    forge: f.forge,
    author,
    collection: "pages",
    schema: true,
    filename: (document) => String(document.frontmatter.slug),
  });
  const first = await store.createDocument({ frontmatter: { slug: "garden" }, body: "First" });
  const second = await store.createDocument({ frontmatter: { slug: "garden" }, body: "Second" });
  await store.publish(selection(first));
  const main = f.branches.get("main");
  await expect(store.publish(selection(second))).rejects.toMatchObject({ code: "conflict" });
  expect(f.branches.get("main")).toBe(main);
  expect((await store.getPublished(first.document.id))?.document.body).toBe("First");
  const count = f.commits.size;
  await expect(
    store.createDocument({
      frontmatter: { slug: "other", id: first.document.id },
      body: "Impersonation",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  expect(f.commits.size).toBe(count);
  const unsafe = createDocumentStore({
    forge: f.forge,
    author,
    collection: "pages",
    schema: true,
    filename: () => "../escape",
  });
  await expect(unsafe.createDocument({ frontmatter: {}, body: "" })).rejects.toThrow(DocumentError);
});

test("filename callbacks receive stable date-only creation metadata and rename atomically", async () => {
  const f = fixture();
  const store = createDocumentStore<{ slug: string }>({
    forge: f.forge,
    author,
    collection: "posts",
    schema: true,
    filename: (document) => `${document.createdAt}-${document.frontmatter.slug}`,
  });
  const draft = await store.createDocument({ frontmatter: { slug: "garden" }, body: "Hello" });
  expect(draft.document.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const saved = await store.saveDraft({
    ...selection(draft),
    document: { frontmatter: { slug: "spring" }, body: "Updated" },
  });
  expect(saved.document.createdAt).toBe(draft.document.createdAt);
  expect(
    f.commits.get(saved.headSha)!.files[`posts/${draft.document.createdAt}-garden/index.md`],
  ).toBeUndefined();
  expect(
    f.commits.get(saved.headSha)!.files[`posts/${draft.document.createdAt}-spring/index.md`],
  ).toContain("Updated");
});

test("public reads never enumerate draft branches", async () => {
  const { store, forge } = setup();
  const draft = await store.createDocument(initial);
  await store.publish(selection(draft));
  forge.listBranches = async () => {
    throw new Error("Public read scanned branches");
  };
  expect((await store.listPublished()).length).toBe(1);
  expect((await store.getPublished(draft.document.id))?.document.body).toBe(initial.body);
});

test("first save retains a client UUID and retries without overwriting drafts", async () => {
  const { store, branches, commits } = setup();
  const id = "2f5ef988-a169-4a8d-9ffb-3522d3fb032c";
  const draft = await store.createDocument({ ...initial, id });
  expect(draft.document.id).toBe(id);
  const count = commits.size;
  expect(await store.createDocument({ ...initial, id })).toEqual(draft);
  expect(commits.size).toBe(count);
  expect([...branches.keys()].filter((branch) => branch.includes(id))).toHaveLength(1);
  await expect(store.createDocument({ ...initial, id, body: "Overwrite" })).rejects.toThrow(
    "different content",
  );
  await expect(store.createDocument({ ...initial, id: "../bad" })).rejects.toThrow(
    "Invalid document UUID",
  );
  await store.publish(selection(draft));
  await expect(store.createDocument({ ...initial, id })).rejects.toThrow("already exists");
});
