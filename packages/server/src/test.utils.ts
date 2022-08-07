import { DocumentConfig } from "./config";
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
