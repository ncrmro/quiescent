import fs from "fs";

export interface DocumentConfig {
  directory: string;
}

interface Config {
  documentTypes: Record<string, DocumentConfig>;
}

export function useConfig(): Config {
  const config: Config = {
    documentTypes: {},
  };
  const fileContents = JSON.parse(
    fs.readFileSync(`${process.cwd()}/quiescent.json`, "utf8")
  );
  if (typeof fileContents.documentTypes !== "object")
    throw "Config is missing documentTypes";

  for (const [key, value] of Object.entries(fileContents.documentTypes)) {
    if (typeof value === "object") {
      config.documentTypes[key] = {
        directory: `${process.cwd()}/public/${key}`,
        ...value,
      } as DocumentConfig;
    }
  }
  return config;
}
