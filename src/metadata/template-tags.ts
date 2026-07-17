const TEMPLATE_TAG_REGEX = /\{\{\s*metadata\.([\w.]+)\s*\}\}/g;

/**
 * Replace `{{ metadata.fieldName }}` template tags in content with
 * the corresponding resolved metadata values.
 *
 * Supports dot-notation for nested access: `{{ metadata.author.name }}`
 * falls back to the top-level frontmatter key if not in metadata fields.
 */
export function resolveTemplateTags(
  content: string,
  metadataValues: Record<string, unknown>,
  frontmatter: Record<string, unknown>
): string {
  return content.replace(TEMPLATE_TAG_REGEX, (match, key: string) => {
    const value =
      resolveNested(metadataValues, key) ?? resolveNested(frontmatter, key);
    if (value === undefined || value === null) {
      return match;
    }
    return String(value);
  });
}

function resolveNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
