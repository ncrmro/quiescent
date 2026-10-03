import { type Schema, Validator } from "@cfworker/json-schema";
import { parseDocument, stringify } from "yaml";
import { DocumentError } from "./document-error.ts";
export type JSONSchema = Schema | boolean;
export type Frontmatter = Record<string, unknown>;
export interface DocumentInput<T extends Frontmatter = Frontmatter> {
  frontmatter: T;
  body: string;
}
/** YAML is parsed as data; Markdown is retained verbatim and never executed. */
export function documentCodec<T extends Frontmatter = Frontmatter>(schema: JSONSchema) {
  const validator = new Validator(schema, "2020-12", false);
  function validate(input: DocumentInput<T>): DocumentInput<T> {
    if (
      !input ||
      typeof input.body !== "string" ||
      !input.frontmatter ||
      typeof input.frontmatter !== "object" ||
      Array.isArray(input.frontmatter)
    )
      throw new DocumentError("A document needs metadata fields and a text body", "invalid");
    let json: string;
    try {
      json = JSON.stringify(input.frontmatter, (_key, value) => {
        if (
          (typeof value === "number" && !Number.isFinite(value)) ||
          ["undefined", "function", "symbol", "bigint"].includes(typeof value)
        )
          throw new Error();
        return value;
      });
    } catch {
      throw new DocumentError("Metadata must be JSON-compatible", "invalid");
    }
    if (json.length + input.body.length > 1024 * 1024)
      throw new DocumentError("Document is too large", "invalid");
    const frontmatter = JSON.parse(json) as T;
    const result = validator.validate(frontmatter);
    if (!result.valid) {
      const fields: Record<string, string> = {};
      for (const error of result.errors) {
        const field =
          error.instanceLocation.replace(/^#\/?/, "").replaceAll("~1", "/").replaceAll("~0", "~") ||
          "_form";
        // Keep the first concrete error; a later boolean-schema wrapper is less useful.
        fields[field] ??= error.error;
      }
      throw new DocumentError("Check the document metadata.", "invalid", fields);
    }
    return { frontmatter, body: input.body };
  }
  return {
    validate,
    parse(source: string): DocumentInput<T> {
      if (source.length > 1024 * 1024) throw new DocumentError("Document is too large", "invalid");
      const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      if (!match) throw new DocumentError("Document needs YAML front matter", "invalid");
      try {
        const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
        if (yaml.errors.length) throw new Error(yaml.errors.map((e) => e.message).join("; "));
        const frontmatter = yaml.toJS({ maxAliasCount: 20 });
        return validate({ frontmatter, body: source.slice(match[0].length) });
      } catch (error) {
        if (error instanceof DocumentError) throw error;
        throw new DocumentError("Invalid YAML front matter", "invalid");
      }
    },
    stringify(input: DocumentInput<T>): string {
      const value = validate(input);
      return `---\n${stringify(value.frontmatter, { lineWidth: 0, aliasDuplicateObjects: false })}---\n${value.body}`;
    },
  };
}
