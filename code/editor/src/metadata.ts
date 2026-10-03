import type { JSONSchema } from "@quiescent/server/documents";
import { createField, loadField, type MetadataField, readField } from "./metadata-fields.ts";
export type MetadataSchema = JSONSchema;
export type { MetadataField } from "./metadata-fields.ts";
export type MetadataControl = (
  parent: HTMLElement,
  name: string,
  onChange: () => void,
) => MetadataField;
/** Schema annotations choose controls; the server validates the full schema on each atomic save. */
export function createMetadataForm(
  parent: HTMLElement,
  schema: MetadataSchema,
  onChange: () => void,
  imageFields: string[] = [],
  controls: Record<string, MetadataControl> = {},
) {
  let original: Record<string, unknown> = {};
  const fields = new Map<string, MetadataField>();
  const containers = new Map<string, HTMLElement>();
  const properties = typeof schema === "boolean" ? {} : (schema.properties ?? {});
  for (const [name, property] of Object.entries(properties)) {
    if (property === false) continue;
    const container = document.createElement("div");
    container.dataset.metadataField = name;
    parent.append(container);
    containers.set(name, container);
    fields.set(
      name,
      controls[name]?.(container, name, onChange) ??
        createField(
          container,
          name,
          property === true ? {} : property,
          imageFields.includes(name),
          onChange,
        ),
    );
  }
  return {
    slots: () =>
      new Map(
        [...fields].map(([name, field]) => [
          name,
          { container: containers.get(name)!, input: field.input },
        ]),
      ),
    read(): Record<string, unknown> {
      return {
        ...original,
        ...Object.fromEntries([...fields].map(([name, field]) => [name, readField(field)])),
      };
    },
    patch(value: Record<string, unknown>) {
      for (const [name, next] of Object.entries(value)) {
        const field = fields.get(name);
        if (field) loadField(field, next);
      }
    },
    load(value: object) {
      original = structuredClone(value) as Record<string, unknown>;
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
