import { buildManifest } from "./manifest";
import { useTempDocument } from "./test.utils";

test("success", async () => {
  const { documentConfig } = await useTempDocument();
  const manifest = await buildManifest(documentConfig);
  expect("moon-flyby" in manifest.documents).toBeTruthy();
  expect(manifest.documents["moon-flyby"].date).toBe("1969-07-20");
});

test("error parsing header", async () => {
  const { documentConfig } = await useTempDocument(undefined, "bad content");
  await expect(buildManifest(documentConfig)).rejects.toThrow(
    /Unable to parse header for/
  );
});
