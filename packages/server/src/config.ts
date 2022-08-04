import fs from "fs";

export interface DocumentConfig {
  directory: string;
  additionalKeys?: { key: string; required: boolean }[];
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
  let fileContents;
  try {
    fileContents = JSON.parse(
      fs.readFileSync(`${process.cwd()}/quiescent.json`, "utf8")
    );
  } catch {
    throw "Quiescent config file does not exist, please create one";
  }

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
