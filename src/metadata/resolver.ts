import type { MetadataFieldConfig } from "../types/config.js";
import type { ResolvedMetadata } from "./types.js";

/**
 * Extract and validate metadata values from MDX frontmatter against
 * the field definitions declared in site.metadata config.
 */
export function resolveMetadata(
  fields: MetadataFieldConfig[],
  frontmatter: Record<string, unknown>
): ResolvedMetadata {
  const errors: string[] = [];
  const values: Record<string, unknown> = {};

  const rawMetadata = frontmatter.metadata as
    | Record<string, unknown>
    | undefined;

  for (const field of fields) {
    const raw = rawMetadata?.[field.name];

    if (raw === undefined || raw === null) {
      if (field.required) {
        errors.push(`Missing required metadata field: ${field.name}`);
      }
      continue;
    }

    const validated = validateValue(field, raw);
    if (validated === undefined) {
      errors.push(
        `Invalid type for metadata field "${field.name}": expected ${field.type}, got ${typeof raw}`
      );
    } else {
      values[field.name] = validated;
    }
  }

  return { fields, values, errors };
}

function validateValue(
  field: MetadataFieldConfig,
  raw: unknown
): unknown | undefined {
  switch (field.type) {
    case "string": {
      const s = String(raw);
      if (field.options && !field.options.includes(s)) {
        return;
      }
      return s;
    }
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        return;
      }
      return n;
    }
    case "boolean": {
      if (typeof raw === "boolean") {
        return raw;
      }
      if (raw === "true") {
        return true;
      }
      if (raw === "false") {
        return false;
      }
      return;
    }
    case "date": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) {
        return;
      }
      return d.toISOString();
    }
    default:
      return;
  }
}
