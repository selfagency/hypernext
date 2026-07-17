import type { MetadataFieldConfig } from "../types/config.js";

export interface ResolvedMetadata {
  /** Validation errors, if any */
  errors: string[];
  /** Field definitions from config */
  fields: MetadataFieldConfig[];
  /** Values keyed by field name, extracted from frontmatter */
  values: Record<string, unknown>;
}

export interface MetadataValue {
  label: string;
  name: string;
  type: string;
  value: unknown;
}
