import type { Content, Root } from "mdast";
import type {
  MdxFlowExpression,
  MdxJsxFlowElement,
  MdxJsxTextElement,
  MdxjsEsm,
  MdxTextExpression,
} from "mdast-util-mdx";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { HypernextConfig } from "../types/config.js";
import { extractFrontmatter } from "./frontmatter.js";
import type { IrNode, ParseResult } from "./ir.js";
import type { ComponentContext } from "./resolver.js";
import { ALLOWED_COMPONENTS, resolveComponent } from "./resolver.js";

type MdastNode =
  | Root
  | Content
  | MdxjsEsm
  | MdxJsxFlowElement
  | MdxJsxTextElement
  | MdxFlowExpression
  | MdxTextExpression;

function isMdxJsxNode(
  node: MdastNode
): node is MdxJsxFlowElement | MdxJsxTextElement {
  return node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";
}

function isMdxExpression(
  node: MdastNode
): node is MdxFlowExpression | MdxTextExpression {
  return node.type === "mdxFlowExpression" || node.type === "mdxTextExpression";
}

function isMdxEsm(node: MdastNode): node is MdxjsEsm {
  return node.type === "mdxjsEsm";
}

// biome-ignore lint/suspicious/noExplicitAny: NodeFactory needs to accept any mdast node type
type NodeFactory = (node: any) => IrNode;

const NODE_CONVERTERS: Record<string, NodeFactory> = {
  root(node) {
    return { type: "root", children: convertChildren((node as Root).children) };
  },
  heading(node) {
    return {
      type: "heading",
      depth: node.depth,
      children: convertChildren(node.children),
    };
  },
  paragraph(node) {
    return { type: "paragraph", children: convertChildren(node.children) };
  },
  text(node) {
    return { type: "text", value: node.value };
  },
  link(node) {
    return {
      type: "link",
      url: node.url,
      children: convertChildren(node.children),
    };
  },
  image(node) {
    return { type: "image", url: node.url, alt: node.alt ?? undefined };
  },
  list(node) {
    return {
      type: "list",
      ordered: node.ordered ?? false,
      start: node.start ?? undefined,
      spread: node.spread ?? false,
      children: convertChildren(node.children),
    };
  },
  listItem(node) {
    return { type: "listItem", children: convertChildren(node.children) };
  },
  code(node) {
    return {
      type: "code",
      lang: node.lang ?? undefined,
      meta: node.meta ?? undefined,
      value: node.value,
    };
  },
  blockquote(node) {
    return { type: "blockquote", children: convertChildren(node.children) };
  },
  thematicBreak() {
    return { type: "thematicBreak" };
  },
  inlineCode(node) {
    return { type: "inlineCode", value: node.value };
  },
  strong(node) {
    return { type: "strong", children: convertChildren(node.children) };
  },
  emphasis(node) {
    return { type: "emphasis", children: convertChildren(node.children) };
  },
  delete(node) {
    return { type: "delete", children: convertChildren(node.children) };
  },
  table(node) {
    return {
      type: "table",
      align: node.align ?? undefined,
      children: convertChildren(node.children),
    };
  },
  tableRow(node) {
    return { type: "tableRow", children: convertChildren(node.children) };
  },
  tableCell(node) {
    return { type: "tableCell", children: convertChildren(node.children) };
  },
  math(node) {
    return { type: "math", value: node.value };
  },
  inlineMath(node) {
    return { type: "inlineMath", value: node.value };
  },
};

function convertMdxJsxNode(
  node: MdxJsxFlowElement | MdxJsxTextElement
): IrNode {
  const name = node.name;
  if (!name) {
    throw new Error("Security Error: JSX element without a name");
  }

  if (!ALLOWED_COMPONENTS.has(name)) {
    throw new Error(`Security Error: Unknown component <${name}>`);
  }

  const props: Record<string, unknown> = {};
  if (node.attributes) {
    for (const attr of node.attributes) {
      if (attr.type === "mdxJsxAttribute") {
        const val = attr.value;
        if (val === null || val === undefined) {
          props[attr.name] = true; // boolean attribute
        } else if (typeof val === "object" && val !== null && "value" in val) {
          // JSX expression: {50}, {true}, {"hello"}, {["a","b"]}
          const exprVal = (val as { value?: string }).value;
          props[attr.name] = tryParseJsxExpression(String(exprVal ?? ""));
        } else {
          props[attr.name] = val;
        }
      }
    }
  }

  function tryParseJsxExpression(expr: string): unknown {
    // Handle numeric literals
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return Number(expr);
    }
    // Handle boolean literals
    if (expr === "true") {
      return true;
    }
    if (expr === "false") {
      return false;
    }
    // Handle string literals
    const strMatch = expr.match(/^"([^"]*)"$/);
    if (strMatch) {
      return strMatch[1]!;
    }
    // Default: return as string
    return expr;
  }

  return {
    type: "component",
    componentName: name,
    componentProps: props,
    children: node.children ? convertChildren(node.children) : undefined,
  };
}

function convertNode(node: MdastNode): IrNode | null {
  if (isMdxJsxNode(node)) {
    return convertMdxJsxNode(node);
  }

  if (isMdxExpression(node)) {
    return { type: "text", value: `{${node.value}}` };
  }

  if (isMdxEsm(node)) {
    return null;
  }

  const factory = NODE_CONVERTERS[node.type];
  return factory ? factory(node) : null;
}

function convertChildren(children: MdastNode[]): IrNode[] {
  const result: IrNode[] = [];
  for (const child of children) {
    const converted = convertNode(child);
    if (converted !== null) {
      result.push(converted);
    }
  }
  return result;
}

export function parseToIR(content: string, _slug?: string): ParseResult {
  const { attributes, body } = extractFrontmatter(content);

  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkMath)
    .use(remarkGfm);

  const mdast = processor.parse(body) as Root;
  const transformed = processor.runSync(mdast) as Root;

  // Walk the AST to reject unknown components before conversion
  visit(transformed, (node: MdastNode) => {
    if (isMdxJsxNode(node) && node.name && !ALLOWED_COMPONENTS.has(node.name)) {
      throw new Error(`Security Error: Unknown component <${node.name}>`);
    }
  });

  const ir = convertNode(transformed) ?? { type: "root", children: [] };

  return {
    ir,
    frontmatter: attributes,
    metadata: (attributes.metadata as Record<string, unknown>) ?? {},
    errors: [],
  };
}

function copyIrNode(target: IrNode, source: IrNode): void {
  // Spread all source fields onto the target, preserving type identity
  Object.assign(target, source);
}

const _MAX_RESOLVE_DEPTH = 10;

export async function resolveComponentNodes(
  ir: IrNode,
  config: HypernextConfig,
  ctxOrSlug?: string | ComponentContext
): Promise<void> {
  const ctx: ComponentContext =
    typeof ctxOrSlug === "string"
      ? { config, currentSlug: ctxOrSlug, includeStack: new Set<string>() }
      : { config, includeStack: new Set<string>(), ...ctxOrSlug };

  // Clone the IR tree to avoid mutating cached parse results
  const clone = JSON.parse(JSON.stringify(ir)) as IrNode;

  async function walk(node: IrNode): Promise<void> {
    if (node.children) {
      for (const child of node.children) {
        await walk(child);
      }
    }

    if (node.type === "component" && node.componentName) {
      const resolved = await resolveComponent(
        node.componentName,
        node.componentProps ?? {},
        ctx
      );
      if (resolved.length === 1 && resolved[0]) {
        copyIrNode(node, resolved[0]);
        // Recursively resolve any nested component nodes in the result
        if (node.children) {
          for (const child of node.children) {
            await walk(child);
          }
        }
      } else {
        node.type = "root";
        node.children = resolved;
        node.componentName = undefined;
        node.componentProps = undefined;
        // Recursively resolve nested components in multi-node results
        if (node.children) {
          for (const child of node.children) {
            await walk(child);
          }
        }
      }
    }
  }

  await walk(clone);

  // Copy resolved nodes back to original IR
  ir.children = clone.children;
  ir.type = clone.type;
}
