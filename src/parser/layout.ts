import fs from "node:fs";
import path from "node:path";

import { DEFAULT_TEMPLATES } from "../constants/default-templates.js";
import type { HypernextConfig } from "../types/config.js";
import type { IrNode, IrNodeType, ParseResult } from "./ir.js";
import { parseToIR, resolveComponentNodes } from "./pipeline.js";

const SLUG_ID_RE = /\//g;

const TEMPLATES_DIR = "templates";
const DEFAULT_LAYOUT = "default.mdx";
const FRONTMATTER_REGEX = /^---[\s\S]*?---\n*/;

function layoutPath(templatesDir: string, name: string): string {
  const normalized = name.endsWith(".mdx") ? name : `${name}.mdx`;
  const resolved = path.resolve(templatesDir, normalized);
  // Prevent path traversal — the resolved path must be inside templatesDir
  const base = path.resolve(templatesDir) + path.sep;
  if (!resolved.startsWith(base)) {
    throw new Error(`Layout path escapes templatesDir: ${name}`);
  }
  return resolved;
}

export function readLayoutRaw(
  templatesDir: string,
  name: string
): string | null {
  const filePath = layoutPath(templatesDir, name);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    // Fall back to embedded defaults
    const normalized = name.endsWith(".mdx") ? name : `${name}.mdx`;
    const embedded = DEFAULT_TEMPLATES.find((t) => t.filename === normalized);
    return embedded?.content ?? null;
  }
}

function findLayout(
  config: HypernextConfig,
  collection: string | undefined,
  explicitLayout: string | undefined
): string {
  if (explicitLayout) {
    return explicitLayout;
  }
  if (
    collection &&
    Object.hasOwn(config.collections, collection) &&
    config.collections[collection]?.layout
  ) {
    return config.collections[collection]?.layout ?? DEFAULT_LAYOUT;
  }
  return DEFAULT_LAYOUT;
}

function hasSlot(ir: IrNode): boolean {
  if (ir.type === "component" && ir.componentName === "slot") {
    return true;
  }
  if (!ir.children) {
    return false;
  }
  for (const child of ir.children) {
    if (hasSlot(child)) {
      return true;
    }
  }
  return false;
}

function replaceSlot(
  ir: IrNode,
  content: IrNode[]
): { replaced: boolean; nodes: IrNode[] } {
  if (ir.type === "component" && ir.componentName === "slot") {
    return { replaced: true, nodes: content };
  }
  if (!ir.children) {
    return { replaced: false, nodes: [ir] };
  }
  const newChildren: IrNode[] = [];
  let anyReplaced = false;
  for (const child of ir.children) {
    const result = replaceSlot(child, content);
    if (result.replaced) {
      anyReplaced = true;
    }
    for (const node of result.nodes) {
      newChildren.push(node);
    }
  }
  if (!anyReplaced) {
    return { replaced: false, nodes: [ir] };
  }
  return { replaced: true, nodes: [{ ...ir, children: newChildren }] };
}

function mergeFrontmatter(
  layoutFm: Record<string, unknown>,
  docFm: Record<string, unknown>
): Record<string, unknown> {
  return { ...layoutFm, ...docFm };
}

/**
 * Inject article-level wrapper (h-entry, Title, PostMeta) around content
 * for single document pages. This replaces the old hard-coded skeleton.
 */
function wrapDocContent(content: IrNode[], slug?: string): IrNode[] {
  if (!slug) return content;

  return [
    {
      type: "article",
      className: "h-entry",
      id: slug.replace(SLUG_ID_RE, "-"),
      children: [
        { type: "component", componentName: "Title", componentProps: {} },
        { type: "component", componentName: "PostMeta", componentProps: {} },
        { type: "section", className: "e-content", children: content },
      ],
    },
  ];
}

/** Map of lowercase JSX element names to their corresponding IR node types. */
const HTML_TAG_TO_IR_TYPE: Partial<Record<string, IrNodeType>> = {
  header: "header",
  main: "main",
  footer: "footer",
  nav: "nav",
  aside: "aside",
  article: "article",
  section: "section",
  div: "section",
  p: "paragraph",
  ul: "list",
  ol: "list",
  li: "listItem",
  blockquote: "blockquote",
  time: "time",
  strong: "strong",
  em: "emphasis",
  code: "code",
  hr: "thematicBreak",
};

/**
 * Walk the IR tree and convert known HTML component nodes to their
 * proper IR node types. This runs AFTER slot replacement so the
 * layout's structural elements (header, nav, main, footer, etc.)
 * are rendered correctly by all protocol renderers (not just HTML).
 */
function convertHtmlComponents(ir: IrNode): IrNode {
  if (ir.type === "component") {
    const name = ir.componentName;
    if (name && HTML_TAG_TO_IR_TYPE[name]) {
      const targetType = HTML_TAG_TO_IR_TYPE[name]!;
      const converted: IrNode = {
        type: targetType as IrNodeType,
        className: ir.componentProps?.className as string | undefined,
        id: ir.componentProps?.id as string | undefined,
        children: ir.children?.map(convertHtmlComponents),
      };
      // Heading-specific: convert depth from tag name
      if (name.startsWith("h") && name.length === 2) {
        converted.depth = Number(name[1]);
      }
      if (name === "a") {
        converted.url = ir.componentProps?.href as string | undefined;
      }
      if (name === "img") {
        converted.url = ir.componentProps?.src as string | undefined;
        converted.alt = ir.componentProps?.alt as string | undefined;
      }
      return converted;
    }
  }
  if (ir.children) {
    return { ...ir, children: ir.children.map(convertHtmlComponents) };
  }
  return ir;
}

export function resolveLayout(
  config: HypernextConfig,
  doc: Record<string, unknown>,
  ctx: {
    collection?: string;
    slug?: string;
    templatesDir?: string;
  }
): ParseResult {
  const templatesDir = ctx.templatesDir ?? TEMPLATES_DIR;
  const explicitLayout = doc.layout as string | undefined;
  const layoutName = findLayout(config, ctx.collection, explicitLayout);

  const layoutRaw = readLayoutRaw(templatesDir, layoutName);
  if (layoutRaw === null) {
    throw new Error(`Layout not found: ${layoutName}`);
  }

  const layoutParse = parseToIR(layoutRaw, layoutName);
  if (!hasSlot(layoutParse.ir)) {
    throw new Error(`Layout ${layoutName} missing <slot />`);
  }

  const rawMdx = (doc.rawMdx as string) ?? "";
  const docParse = parseToIR(rawMdx, ctx.slug);

  // Determine the content to place inside the layout's <slot />
  // For single docs, wrap in article-level structure (h-entry, Title, PostMeta)
  const docChildren = docParse.ir.children ?? [];
  const slotContent = ctx.slug
    ? wrapDocContent(docChildren, ctx.slug)
    : docChildren;

  // Replace <slot /> in the layout IR with the (optionally wrapped) content
  const slotResult = replaceSlot(layoutParse.ir, slotContent);
  // Convert layout HTML elements (header, nav, main, etc.) from component
  // IR nodes to their proper types for cross-protocol renderer compatibility
  const slotMerged = slotResult.replaced
    ? slotResult.nodes.length === 1
      ? slotResult.nodes[0]!
      : { type: "root" as const, children: slotResult.nodes }
    : layoutParse.ir;
  const mergedIr = convertHtmlComponents(slotMerged);

  const mergedFrontmatter = mergeFrontmatter(
    layoutParse.frontmatter,
    docParse.frontmatter
  );

  return {
    ir: mergedIr,
    frontmatter: mergedFrontmatter,
    metadata: (mergedFrontmatter.metadata as Record<string, unknown>) ?? {},
    errors: [],
  };
}

export async function resolveLayoutWithComponents(
  config: HypernextConfig,
  doc: Record<string, unknown>,
  ctx: {
    collection?: string;
    slug?: string;
    templatesDir?: string;
    currentDocId?: number;
  }
): Promise<ParseResult> {
  const result = resolveLayout(config, doc, {
    collection: ctx.collection,
    slug: ctx.slug,
    templatesDir: ctx.templatesDir,
  });

  const rawBody = ((doc.rawMdx as string) ?? "").replace(FRONTMATTER_REGEX, "");
  await resolveComponentNodes(result.ir, config, {
    config,
    currentSlug: ctx.slug,
    currentDocId: ctx.currentDocId,
    body: rawBody || undefined,
    frontmatter: result.frontmatter,
  });

  return result;
}
