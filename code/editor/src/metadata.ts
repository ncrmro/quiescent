import type { JSONSchema } from "@quiescent/server/documents";
import { createField, loadField, type MetadataField, readField } from "./metadata-fields.ts";
export type MetadataSchema = JSONSchema;
/** Schema annotations choose controls; the server validates the full schema on each atomic save. */
export function createMetadataForm(
  parent: HTMLElement,
  schema: MetadataSchema,
  onChange: () => void,
  imageFields: string[] = [],
) {
  const fields = new Map<string, MetadataField>();
  const properties = typeof schema === "boolean" ? {} : (schema.properties ?? {});
  for (const [name, property] of Object.entries(properties)) {
    if (property === false) continue;
    fields.set(
      name,
      createField(
        parent,
        name,
        property === true ? {} : property,
        imageFields.includes(name),
        onChange,
      ),
    );
  }
  return {
    read(): Record<string, unknown> {
      return Object.fromEntries([...fields].map(([name, field]) => [name, readField(field)]));
    },
    load(value: object) {
      const values: Record<string, unknown> = { ...value };
      for (const [name, field] of fields) loadField(field, values[name]);
    },
    disable(disabled: boolean) {
      for (const { input } of fields.values()) input.disabled = disabled;
    },
    errors(errors: Record<string, string> = {}) {
      for (const [name, { input, error }] of fields) {
        const message =
          errors[name] ?? Object.entries(errors).find(([key]) => key.startsWith(`${name}/`))?.[1];
        error.textContent = message ?? "";
        error.hidden = !message;
        if (message) input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    },
    field(name: string) {
      return fields.get(name)?.input;
    },
  };
}
