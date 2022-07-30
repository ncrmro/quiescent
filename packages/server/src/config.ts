import fs from "fs";

export interface DocumentConfig {
  directory: string;
}

interface Config {
  documentTypes: Record<string, DocumentConfig>;
}

function isDocumentConfig(object: any): object is DocumentConfig {
  return "directory" in object;
}

/**
 * Reads the quiescent.json from project root
 * validates and returns it.
 */
export function useConfig(): Config {
  const config: Config = {
    documentTypes: {},
  };
  const fileContents = JSON.parse(
    fs.readFileSync(`${process.cwd()}/quiescent.json`, "utf8")
  );
  if (typeof fileContents.documentTypes !== "object")
    throw "Config is missing documentTypes";

  for (const [documentType, documentConfig] of Object.entries(
    fileContents.documentTypes
  )) {
    if (!isDocumentConfig(documentConfig))
      throw `Error processing document type ${documentType}`;
    config.documentTypes[documentType] = documentConfig;
  }
  return config;
}
