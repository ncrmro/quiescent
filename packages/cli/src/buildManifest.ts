import fs from "fs/promises";
import { buildManifest } from "@quiescent/server";

export default async function (documentDirectory: string) {
  const manifest = buildManifest(documentDirectory);
  await fs.writeFile(
    `${documentDirectory}/manifest.json`,
    JSON.stringify(manifest)
  );
}
