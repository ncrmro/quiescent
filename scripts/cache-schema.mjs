import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineDocumentConfig, documentCacheIndexStatements } from "../code/server/dist/index.js";

const configuration = defineDocumentConfig(
  JSON.parse(
    await readFile(
      process.argv[2] ?? new URL("../code/web/quiescent.config.json", import.meta.url),
      "utf8",
    ),
  ),
);
const indexes = Object.values(configuration.collections).flatMap(
  (collection) => collection.indexes ?? [],
);
const base = await readFile(
  fileURLToPath(new URL("../code/server/src/documents-cache.schema.sql", import.meta.url)),
  "utf8",
);
process.stdout.write(`${base}\n${documentCacheIndexStatements(indexes).join("\n")}\n`);
