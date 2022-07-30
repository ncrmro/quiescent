import fs from "fs/promises";
import { useConfig, buildManifest } from "@quiescent/server";
import { ArgumentsCamelCase } from "yargs";
import { DocumentConfig } from "@quiescent/server";

async function buildDocumentTypeManifest({ directory }: DocumentConfig) {
  const manifest = await buildManifest(directory);
  await fs.writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
}

/**
 * Iterates over each document type from the config file
 * and builds it's manifest
 * @param args
 */
export default async function (args: ArgumentsCamelCase) {
  const config = useConfig();
  const documentConfigs = Object.values(config.documentTypes);
  await Promise.all(documentConfigs.map(buildDocumentTypeManifest));
}
