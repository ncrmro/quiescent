import { expect, test } from "bun:test";
import { GitHubForge } from "../../git/src/github.ts";
import { documentCodec } from "../src/document-codec.ts";
import { createDocumentStore } from "../src/document-store.ts";
import { fixture } from "./forge-fixture.ts";

const author = { name: "Writer", email: "writer@example.test" };
test("73 documents use bounded GitHub batches and fresh heads on each listing", async () => {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const sha = (i: number) => String(i).padStart(40, "a");
  const main = sha(0);
  const files = new Map<string, Record<string, string>>([[main, {}]]);
  const branches: Array<{ name: string; commit: { sha: string } }> = [];
  for (let i = 1; i <= 73; i++) {
    const ref = i <= 42 ? main : sha(i);
    const tree = files.get(ref) ?? {};
    tree[`posts/.quiescent/${id(i)}.json`] = JSON.stringify({
      directory: `posts/${id(i)}`,
      ...(i <= 42 ? { publishedAt: "2026-01-01T00:00:00Z" } : {}),
    });
    tree[`posts/${id(i)}/index.md`] = documentCodec(true).stringify({
      frontmatter: { id: id(i), createdAt: "2026-01-01", title: `Post ${i}` },
      body: `Body ${i}`,
    });
    files.set(ref, tree);
    if (i > 42) branches.push({ name: `quiescent/posts/${id(i)}/${id(i)}`, commit: { sha: ref } });
  }
  const requests: string[] = [];
  const client = new GitHubForge({
    kind: "github",
    owner: "example",
    repo: "posts",
    token: "test",
    fetch: (async (input, init) => {
      const url = String(input);
      requests.push(url);
      let response: unknown;
      if (url.endsWith("/graphql")) {
        const { variables } = JSON.parse(String(init?.body));
        if (variables.expression) {
          const [ref, directory] = variables.expression.split(":");
          const entries = Object.entries(files.get(ref)!)
            .filter(([path]) => path.startsWith(`${directory}/`))
            .map(([path, text]) => ({
              name: path.split("/").at(-1),
              type: "blob",
              object: { oid: sha(999), text, isTruncated: false },
            }));
          return Response.json({
            data: { repository: { object: { __typename: "Tree", entries } } },
          });
        }
        if (variables.branch) {
          const ref = Object.fromEntries(
            Object.entries(variables)
              .filter(([key]) => /^a\d+$/.test(key))
              .map(([key, value]) => [
                key,
                { status: "DIVERGED", baseTarget: { oid: main }, headTarget: { oid: value } },
              ]),
          );
          return Response.json({ data: { repository: { ref } } });
        }

        const repository = Object.fromEntries(
          Object.entries(variables)
            .filter(([key]) => key.startsWith("e"))
            .map(([key, value]) => {
              const [ref, path] = String(value).split(":");
              const text = files.get(ref!)?.[path!];
              return [
                `f${key.slice(1)}`,
                text === undefined
                  ? null
                  : { __typename: "Blob", oid: sha(999), text, isTruncated: false },
              ];
            }),
        );
        response = { data: { repository } };
      } else if (url.includes("/git/ref/heads/main")) response = { object: { sha: main } };
      else if (url.includes("/branches?")) response = branches;
      else if (url.includes("/contents/posts/.quiescent"))
        response = Object.keys(files.get(main)!)
          .filter((path) => path.endsWith(".json"))
          .map((path) => ({
            path,
            name: path.split("/").at(-1),
            type: "file",
            sha: main,
            size: 1,
          }));
      else if (url.includes("/compare/")) response = { status: "diverged" };
      else throw new Error(`Unexpected GitHub request ${url}`);
      return Response.json(response);
    }) as typeof fetch,
  });
  const store = createDocumentStore({ forge: client, author, collection: "posts", schema: true });
  const first = await store.listDocuments();
  expect(first).toHaveLength(73);
  expect(requests.filter((url) => url.endsWith("/graphql"))).toHaveLength(7);
  expect(requests).toHaveLength(9); // 2 discovery + 1 directory + 5 file batches + 1 ancestry batch, previously 243.
  const branch = branches[0]!;
  const next = sha(100);
  const changed = { ...files.get(branch.commit.sha)! };
  changed[`posts/${id(43)}/index.md`] = changed[`posts/${id(43)}/index.md`]!.replace(
    "Body 43",
    "External edit",
  );
  files.set(next, changed);
  branch.commit.sha = next;
  requests.length = 0;
  expect(
    (await store.listDocuments()).find((row) => row.document.id === id(43))?.document.body,
  ).toContain("External edit");
  expect(requests).toHaveLength(9);
});

test("read-only draft selection never starts a cycle and rejects published/deleted revisions", async () => {
  const { forge, branches, commits } = fixture();
  const store = createDocumentStore({ forge, author, collection: "posts", schema: true });
  const draft = await store.createDocument({ frontmatter: { title: "Test" }, body: "Body" });
  const count = commits.size;
  expect(await store.readDraft(draft.document.id, draft.branch!)).toEqual(draft);
  expect(commits.size).toBe(count);
  await store.publish({
    id: draft.document.id,
    branch: draft.branch!,
    expectedHeadSha: draft.headSha,
  });
  const publishedCount = commits.size;
  const branchCount = branches.size;
  expect(await store.readDraft(draft.document.id, draft.branch!)).toBeNull();
  expect(commits.size).toBe(publishedCount);
  expect(branches.size).toBe(branchCount);
  expect((await store.listDocuments())[0]?.state).toBe("published");
  const opened = await store.openDocument(draft.document.id);
  const edit = await store.saveDocument({
    id: opened.document.id,
    branch: opened.branch,
    expectedHeadSha: opened.headSha,
    document: { ...opened.document, body: "Private revision before deletion" },
  });
  await store.deleteDocument({
    id: edit.document.id,
    branch: edit.branch,
    expectedHeadSha: edit.headSha,
  });
  expect(await store.readDraft(edit.document.id, edit.branch!)).toBeNull();
  expect(await store.listDocuments()).toEqual([]);
});

test("listing skips retained merged branches written against an obsolete schema", async () => {
  const { forge } = fixture();
  const original = createDocumentStore({ forge, author, collection: "posts", schema: true });
  const draft = await original.createDocument({ frontmatter: { title: "Old" }, body: "Body" });
  await original.publish({
    id: draft.document.id,
    branch: draft.branch!,
    expectedHeadSha: draft.headSha,
  });
  const head = await forge.getBranchSha("main");
  const path = `posts/${draft.document.id}/index.md`;
  const file = (await forge.getFile(path, head))!;
  await forge.commitFiles({
    branch: "main",
    expectedHeadSha: head,
    message: "Migrate schema",
    files: [
      {
        path,
        content: file.content.replace("title: Old", "title: Old\nrequiredNewField: present"),
      },
    ],
  });
  const upgraded = createDocumentStore({
    forge,
    author,
    collection: "posts",
    schema: { type: "object", required: ["requiredNewField"] },
  });
  expect(await upgraded.listDocuments()).toHaveLength(1);
});

test("authoritative tombstones skip obsolete draft and main Markdown before schema validation", async () => {
  const { forge } = fixture();
  const old = createDocumentStore({ forge, author, collection: "posts", schema: true });
  const draft = await old.createDocument({ frontmatter: { title: "Old" }, body: "Old schema" });
  await old.deleteDocument({
    id: draft.document.id,
    branch: draft.branch,
    expectedHeadSha: draft.headSha,
  });
  const upgraded = createDocumentStore({
    forge,
    author,
    collection: "posts",
    schema: { type: "object", required: ["newRequiredField"] },
  });
  expect(await upgraded.listDocuments()).toEqual([]);
});
