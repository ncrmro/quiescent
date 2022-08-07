import fs from "fs/promises";
import { buildManifest } from "./manifest";

test("success", async () => {
  const fileName = "1969_07_20_moon-flyby.md";
  const tempDir = `/tmp/quiescent-tests-${Date.now().toString()}`;
  const documentsFolder = `${tempDir}/posts`;
  await fs.mkdir(documentsFolder, { recursive: true });
  await fs.writeFile(
    `${documentsFolder}/${fileName}`,
    `
---
title: Test
tags: foo,bar
---

hello world
  `
  );
  const manifest = await buildManifest({
    directory: documentsFolder,
    // TODO test keys
    // additionalKeys: [],
  });
  expect("moon-flyby" in manifest.documents).toBeTruthy();
  expect(manifest.documents["moon-flyby"].date).toBe("1969-07-20");
});

test("error parsing header", async () => {
  const fileName = "1969_07_20_moon-flyby.md";
  const tempDir = `/tmp/quiescent-tests-${Date.now().toString()}`;
  const documentsFolder = `${tempDir}/posts`;
  await fs.mkdir(documentsFolder, { recursive: true });
  await fs.writeFile(`${documentsFolder}/${fileName}`, ``);
  await expect(buildManifest({ directory: documentsFolder })).rejects.toThrow(
    /Unable to parse header for/
  );
});
