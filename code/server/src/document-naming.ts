import type { DocumentRecord } from "./contracts.ts";
import type { Frontmatter } from "./document-codec.ts";
import { DocumentError } from "./document-error.ts";

export function documentDirectory(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(value))
    throw new DocumentError("Invalid collection directory", "invalid");
  return value;
}

export function filenameTemplate<T extends Frontmatter>(template: string) {
  const tokens = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
  if (
    !/^[a-zA-Z0-9_{}-]+$/.test(template) ||
    tokens.some((key) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) ||
    /[{}]/.test(template.replace(/\{[^{}]+\}/g, ""))
  )
    throw new DocumentError("Invalid filename template", "invalid");
  return (document: DocumentRecord<T>) =>
    template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
      const value =
        key === "id"
          ? document.id
          : key === "createdAt"
            ? document.createdAt
            : document.frontmatter[key];
      if (typeof value !== "string" || !value)
        throw new DocumentError(`Filename field ${key} must be a nonempty string`, "invalid");
      return value;
    });
}

/** Only immutable identity fields belong in branch names; slugs can change during editing. */
export function draftBranches(
  collection: string,
  template = "quiescent/{collection}/{id}/{cycle}",
) {
  const resolved = template.replaceAll("{collection}", collection);
  if (
    !/^[a-zA-Z0-9_{}/-]+$/.test(resolved) ||
    resolved.split("{id}").length !== 2 ||
    resolved.split("{cycle}").length !== 2
  )
    throw new DocumentError("Draft branch template needs one {id} and one {cycle}", "invalid");
  documentDirectory(resolved.replace("{id}", "id").replace("{cycle}", "cycle"));
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const pattern = new RegExp(
    `^${resolved.replace("{id}", `(?<id>${uuid})`).replace("{cycle}", `(?<cycle>${uuid})`)}$`,
  );
  const prefix = resolved.split("{")[0]!;
  return {
    prefix,
    listPrefix: (id?: string) => (id ? resolved.replace("{id}", id).split("{")[0]! : prefix),
    name: (id: string, cycle: string) => resolved.replace("{id}", id).replace("{cycle}", cycle),
    id: (branch: string) => pattern.exec(branch)?.groups?.id,
  };
}
