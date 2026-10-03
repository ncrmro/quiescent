import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileMedia } from "../src/file-media.ts";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
test("local media stores raw generations and open readers survive concurrent replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "quiescent-media-"));
  try {
    const media = fileMedia(root);
    await media.restore("post", "image.png", png.buffer, "image/png");
    const metadata = JSON.parse(await readFile(join(root, "images/post/image.png"), "utf8")) as {
      version: number;
      oid: string;
      size: number;
      body?: string;
    };
    expect(metadata.version).toBe(2);
    expect(metadata.body).toBeUndefined();
    expect(metadata.size).toBe(png.length);
    expect(
      new Uint8Array(await readFile(join(root, `images/post/image.png.${metadata.oid}.bin`))),
    ).toEqual(png);
    const original = await media.read("post", "image.png");
    const replacement = new Uint8Array([...png, 2]);
    await media.restore("post", "image.png", replacement.buffer, "image/png");
    expect(new Uint8Array(await new Response(original!.body).arrayBuffer())).toEqual(png);
    expect(
      new Uint8Array(
        await new Response((await fileMedia(root).read("post", "image.png"))!.body).arrayBuffer(),
      ),
    ).toEqual(replacement);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy base64 media remains readable while subsequent writes use raw bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "quiescent-legacy-media-"));
  try {
    await mkdir(join(root, "images/post"), { recursive: true });
    await writeFile(
      join(root, "images/post/legacy.png"),
      JSON.stringify({ contentType: "image/png", body: Buffer.from(png).toString("base64") }),
    );
    const media = fileMedia(root);
    expect(
      new Uint8Array(
        await new Response((await media.read("post", "legacy.png"))!.body).arrayBuffer(),
      ),
    ).toEqual(png);
    await media.restore("post", "legacy.png", png.buffer, "image/png");
    expect(JSON.parse(await readFile(join(root, "images/post/legacy.png"), "utf8")).version).toBe(
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
