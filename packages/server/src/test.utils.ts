import { Config, DocumentConfig } from "./config";
import fs from "fs/promises";

export async function useTempDocumentConfig(
  documentConfig: Partial<DocumentConfig> = {}
): Promise<DocumentConfig> {
  if (!documentConfig.directory) {
    const tempDir = `/tmp/quiescent-tests-${Date.now().toString()}`;
    documentConfig.directory = `${tempDir}/posts`;
  }
  await fs.mkdir(documentConfig.directory, { recursive: true });
  return { directory: documentConfig.directory, ...documentConfig };
}

export async function useTempConfig(config: Partial<Config> = {}) {
  const tempDir = `/tmp/quiescent-tests-${Date.now().toString()}`;
  config.documentTypes ||= {};
  config.documentTypes.posts ||= { directory: `${tempDir}/posts` };

  const configPath = `${tempDir}/quiescent.json`;

  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config));
  return {
    configPath,
    config,
  };
}

export async function useTempDocument(
  documentConfig: Partial<DocumentConfig> = {},
  content?: string
) {
  const dc = await useTempDocumentConfig(documentConfig);
  content ||= `
---
title: Test
tags: foo,bar
---

hello world
  `;
  const documentFilename = "1969_07_20_moon-flyby.md";
  await fs.writeFile(
    `${documentConfig.directory}/${documentFilename}`,
    content
  );
  return { documentConfig: dc, documentFilename };
}
