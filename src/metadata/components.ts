import type { MetadataValue } from "./types.js";

/**
 * Resolve a `<Metadata name="key" />` JSX component in MDX content.
 * Returns the formatted value as a string for injection into the IR.
 */
export function resolveMetadataComponent(
  name: string,
  metadataValues: MetadataValue[]
): string | undefined {
  const entry = metadataValues.find((m) => m.name === name);
  if (!entry) {
    return;
  }

  const value = entry.value;
  if (value === null || value === undefined) {
    return;
  }

  return String(value);
}
