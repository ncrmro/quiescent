import type { JSONSchema } from "@quiescent/server/documents";
export type FieldSchema = Exclude<JSONSchema, boolean>;
export type FieldInput = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export interface MetadataField {
  input: FieldInput;
  error: HTMLElement;
  type: string;
  nullable: boolean;
  schema: FieldSchema;
  read?: () => unknown;
  load?: (value: unknown) => void;
}
function textInput(schema: FieldSchema, type: string, hidden: boolean) {
  const input = document.createElement("input");
  const types: Record<string, string> = {
    boolean: "checkbox",
    integer: "number",
    number: "number",
  };
  input.type = hidden ? "hidden" : (types[type] ?? "text");
  if (type === "number") input.step = "any";
  if (schema.minimum !== undefined) input.min = String(schema.minimum);
  if (schema.maximum !== undefined) input.max = String(schema.maximum);
  if (schema.maxLength !== undefined) input.maxLength = schema.maxLength;
  if (type === "array") input.placeholder = "Separate values with commas";
  return input;
}
function createInput(schema: FieldSchema, type: string, hidden: boolean): FieldInput {
  if (schema.enum) {
    const input = document.createElement("select");
    schema.enum.forEach((value, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = String(value);
      input.append(option);
    });
    return input;
  }
  return type === "object" || (type === "array" && structuredArray(schema))
    ? document.createElement("textarea")
    : textInput(schema, type, hidden);
}
function description(
  parent: HTMLElement,
  name: string,
  schema: FieldSchema,
  input: FieldInput,
  error: HTMLElement,
) {
  if (!schema.description) return;
  const help = document.createElement("small");
  help.id = `metadata-${name}-help`;
  help.textContent = schema.description;
  parent.append(help);
  input.setAttribute("aria-describedby", `${help.id} ${error.id}`);
}
export function createField(
  parent: HTMLElement,
  name: string,
  schema: FieldSchema,
  hidden: boolean,
  onChange: () => void,
): MetadataField {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "string"];
  const type = types.find((value) => value !== "null") ?? "string";
  const input = createInput(schema, type, hidden);
  input.name = name;
  input.dataset.field = name;
  if (name === "title" || name === "description") input.setAttribute(`data-${name}`, "");
  const label = document.createElement("label");
  label.textContent = schema.title ?? name;
  label.append(input);
  const error = document.createElement("small");
  error.id = `metadata-${name}-error`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);
  input.addEventListener("input", () => {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    onChange();
  });
  parent.append(label);
  description(parent, name, schema, input, error);
  parent.append(error);
  return { input, error, type, nullable: types.includes("null"), schema };
}
function structuredArray(schema: FieldSchema) {
  return (
    !schema.items ||
    typeof schema.items !== "object" ||
    Array.isArray(schema.items) ||
    schema.items.type !== "string"
  );
}
export function readField({ input, type, nullable, schema, read }: MetadataField): unknown {
  if (read) return read();
  if (input instanceof HTMLSelectElement) return schema.enum?.[input.selectedIndex];
  if (type === "boolean") return (input as HTMLInputElement).checked;
  const value = input.value;
  if (nullable && value === "") return null;
  switch (type) {
    case "array":
      if (structuredArray(schema)) return JSON.parse(value || "[]") as unknown;
      return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    case "number":
    case "integer":
      return value === "" ? null : Number(value);
    case "object":
      return JSON.parse(value) as unknown;
    default:
      return value;
  }
}
export function loadField({ input, type, schema, load }: MetadataField, value: unknown) {
  if (load) {
    load(value);
    return;
  }
  if (input instanceof HTMLSelectElement) {
    input.selectedIndex =
      schema.enum?.findIndex((v) => JSON.stringify(v) === JSON.stringify(value)) ?? -1;
    return;
  }
  if (type === "boolean") {
    (input as HTMLInputElement).checked = Boolean(value);
    return;
  }
  if (type === "array") {
    input.value = structuredArray(schema)
      ? JSON.stringify(value ?? [], null, 2)
      : Array.isArray(value)
        ? value.join(", ")
        : "";
    return;
  }
  if (type === "object") {
    input.value = JSON.stringify(value ?? {}, null, 2);
    return;
  }
  input.value = String(value ?? "");
}
