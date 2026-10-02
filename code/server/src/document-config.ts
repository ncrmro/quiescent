import { Validator } from "@cfworker/json-schema";
import configurationSchema from "./config.schema.json" with { type: "json" };
import type { Frontmatter, JSONSchema } from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";
import { documentDirectory, draftBranches, filenameTemplate } from "./document-naming.ts";

export interface CollectionConfig {
  schema: JSONSchema;
  directory?: string;
  filename?: string;
  draftBranch?: string;
}
export interface QuiescentConfig {
  $schema?: string;
  repository: { provider: "github"; owner: string; name: string; publishedBranch?: string };
  collections: Record<string, CollectionConfig>;
}

/** Accept imported JSON, without filesystem access or secrets in the configuration. */
export function defineDocumentConfig(input: unknown): QuiescentConfig {
  const result = new Validator(configurationSchema as JSONSchema).validate(input);
  if (!result.valid)
    throw new DocumentError(
      `Invalid Quiescent configuration: ${result.errors.map((error) => `${error.instanceLocation}: ${error.error}`).join("; ")}`,
      "invalid",
    );
  const config = input as QuiescentConfig;
  const directories: string[] = [];
  for (const [name, collection] of Object.entries(config.collections)) {
    const directory = documentDirectory(collection.directory ?? name);
    if (
      directories.some(
        (other) =>
          directory === other ||
          directory.startsWith(`${other}/`) ||
          other.startsWith(`${directory}/`),
      )
    )
      throw new DocumentError("Collection directories must not overlap", "invalid");
    directories.push(directory);
    draftBranches(name, collection.draftBranch);
    filenameTemplate(collection.filename ?? "{id}");
    new Validator(collection.schema, "2020-12", false);
  }
  return config;
}

/** Feed these options to either createDocumentStore or createDocumentService. */
export function configuredCollection<T extends Frontmatter = Frontmatter>(
  config: QuiescentConfig,
  name: string,
) {
  const collection = config.collections[name];
  if (!collection) throw new DocumentError(`Unknown collection: ${name}`, "invalid");
  return {
    collection: name,
    schema: collection.schema,
    directory: collection.directory ?? name,
    defaultBranch: config.repository.publishedBranch ?? "main",
    draftBranch: collection.draftBranch ?? "quiescent/{collection}/{id}/{cycle}",
    filename: filenameTemplate<T>(collection.filename ?? "{id}"),
  };
}
