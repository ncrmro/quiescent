import fs from "fs";

export const additionalKeyTypes = ["string", "array"] as const;

export interface AdditionalKey {
  required: boolean;
  type: typeof additionalKeyTypes[number];
}

export interface DocumentConfig {
  directory: string;
  additionalKeys?: Record<string, AdditionalKey>;
}

export interface Config {
  documentTypes: Record<string, DocumentConfig>;
}

function isAdditionalKeysObj(
  documentType: string,
  key: string,
  object: any
): object is AdditionalKey {
  if (!("required" in object) || typeof object.required !== "boolean")
    throw new Error(
      `Additional key ${key} is missing required or is not of type boolean`
    );
  if (!("type" in object))
    throw new Error(
      `Error parsing config documentType ${documentType}, additional key ${key} is missing type.`
    );
  if (!additionalKeyTypes.find((i) => i === object.type))
    throw new Error(`Additional key ${key} with value ${object.type}`);
  return true;
}

function isDocumentConfig(object: any): object is DocumentConfig {
  return "directory" in object;
}

/**
 * Reads the quiescent.json from project root
 * validates and returns it.
 */
export function useConfig(
  documentConfigPath = `${process.cwd()}/quiescent.json`
): Config {
  const config: Config = {
    documentTypes: {},
  };
  let fileContents;
  try {
    fileContents = JSON.parse(fs.readFileSync(documentConfigPath, "utf8"));
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
    if (documentConfig.additionalKeys) {
      for (const [key, additionalKey] of Object.entries(
        documentConfig.additionalKeys
      )) {
        isAdditionalKeysObj(documentType, key, additionalKey);
      }
    }

    config.documentTypes[documentType] = documentConfig;
  }
  return config;
}
