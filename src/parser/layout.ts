import fs from "node:fs";
import path from "node:path";

import { DEFAULT_TEMPLATES } from "../templates/default-templates.js";
import type { HypernextConfig } from "../types/config.js";
import type { IrNode, ParseResult } from "./ir.js";
import { parseToIR, resolveComponentNodes } from "./pipeline.js";

const TEMPLATES_DIR = "templates";
const DEFAULT_LAYOUT = "default.mdx";
const FRONTMATTER_REGEX = /^---[\s\S]*?---\n*/;

function layoutPath(templatesDir: string, name: string): string {
  const normalized = name.endsWith(".mdx") ? name : `${name}.mdx`;
  return path.resolve(templatesDir, normalized);
}

function readLayoutRaw(templatesDir: string, name: string): string | null {
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
  if (collection && config.collections[collection]?.layout) {
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

function textNode(value: string): IrNode {
  return { type: "text", value };
}

function componentNode(
  name: string,
  props: Record<string, unknown> = {}
): IrNode {
  return { type: "component", componentName: name, componentProps: props };
}

function wrapSkeleton(
  content: IrNode[],
  config: HypernextConfig,
  _collection: string | undefined,
  frontmatter: Record<string, unknown>,
  slug?: string
): IrNode {
  const title = (frontmatter.title as string) ?? config.site.meta.title;
  const date = frontmatter.date as string | undefined;
  const author = config.author?.name;

  // Wrap content in h-entry microformats when there's a title
  let mainContent: IrNode[] = [componentNode("Breadcrumbs")];
  if (slug) {
    const postUrl = `/${slug}`;
    const hEntry: IrNode[] = [];
    hEntry.push({
      type: "heading",
      depth: 1,
      className: "p-name",
      children: [textNode(title)],
    });
    if (date) {
      const d = new Date(date);
      const display = Number.isNaN(d.getTime())
        ? date
        : d.toISOString().slice(0, 10);
      hEntry.push({
        type: "paragraph",
        children: [
          {
            type: "time",
            value: display,
            datetime: date,
            className: "dt-published",
          },
        ],
      });
    }
    if (author) {
      hEntry.push({
        type: "paragraph",
        className: "p-author h-card",
        children: [textNode(author)],
      });
    }
    // Document body
    const wrapped: IrNode[] = [...content];
    hEntry.push({
      type: "section",
      className: "e-content",
      children: wrapped,
    });
    hEntry.push({
      type: "paragraph",
      children: [
        {
          type: "link",
          url: postUrl,
          className: "u-url",
          children: [textNode("Permalink")],
        },
      ],
    });
    mainContent.push({
      type: "section",
      className: "h-entry",
      id: slug.replace(/\//g, "-"),
      children: hEntry,
    });
  } else {
    mainContent = [...mainContent, ...content];
  }

  return {
    type: "root",
    children: [
      {
        type: "header",
        className: "site-header",
        children: [componentNode("NavMenu"), componentNode("Search")],
      },
      {
        type: "main",
        className: "main-content",
        children: mainContent,
      },
      {
        type: "footer",
        className: "site-footer",
        children: [
          textNode(`© ${new Date().getFullYear()} ${config.site.meta.title}`),
        ],
      },
    ],
  };
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

  const slotResult = replaceSlot(layoutParse.ir, docParse.ir.children ?? []);
  let slotContent: IrNode[];
  if (slotResult.replaced) {
    slotContent =
      slotResult.nodes.length === 1 && slotResult.nodes[0]?.type === "root"
        ? (slotResult.nodes[0].children ?? [])
        : slotResult.nodes;
  } else {
    slotContent = docParse.ir.children ?? [];
  }
  const mergedIr = wrapSkeleton(
    slotContent,
    config,
    ctx.collection,
    docParse.frontmatter,
    ctx.slug
  );

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
  });

  return result;
}
