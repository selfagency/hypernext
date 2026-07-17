import fs from "node:fs";
import type { IrNode, ParseResult } from "./ir.js";
import { parseToIR } from "./pipeline.js";

/**
 * Parse a layout template, find the <slot /> marker, and inject
 * the post's IR children at that position.
 */
export function applyLayout(
  layoutPath: string,
  postResult: ParseResult
): ParseResult {
  if (!fs.existsSync(layoutPath)) {
    return postResult;
  }

  const layoutContent = fs.readFileSync(layoutPath, "utf-8");
  const layoutResult = parseToIR(layoutContent);

  const merged = injectIntoSlot(layoutResult.ir, postResult.ir);

  return {
    ir: merged,
    frontmatter: { ...layoutResult.frontmatter, ...postResult.frontmatter },
    metadata: postResult.metadata,
    errors: [...layoutResult.errors, ...postResult.errors],
  };
}

function injectIntoSlot(layoutIr: IrNode, postIr: IrNode): IrNode {
  if (layoutIr.type !== "root") {
    return layoutIr;
  }

  const children: IrNode[] = [];
  for (const child of layoutIr.children ?? []) {
    if (isSlotComponent(child)) {
      children.push(...(postIr.children ?? []));
    } else {
      children.push(child);
    }
  }

  return { type: "root", children };
}

function isSlotComponent(node: IrNode): boolean {
  return node.type === "component" && node.componentName === "slot";
}
