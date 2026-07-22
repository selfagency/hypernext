import type { IrNode } from "../parser/ir.js";

function renderMention(node: IrNode): string {
  const lines: string[] = [];
  if (node.authorName) {
    lines.push(
      `> ${node.authorName}${node.platform ? ` via ${node.platform}` : ""}`
    );
  }
  if (node.content) {
    for (const line of node.content.split("\n")) {
      lines.push(`> ${line}`);
    }
  }
  if (node.sourceUrl) {
    lines.push(`> ${node.sourceUrl}`);
  }
  return lines.join("\n");
}

function renderGemtextNode(node: IrNode, depth = 0): string {
  const indent = "  ".repeat(depth);

  switch (node.type) {
    case "root":
      return (node.children ?? []).map((c) => renderGemtextNode(c)).join("\n");

    case "heading": {
      const prefix = "#".repeat(Math.min(node.depth ?? 1, 3));
      const text = (node.children ?? []).map((c) => c.value ?? "").join("");
      return `${indent}${prefix} ${text}`;
    }

    case "paragraph":
      return (node.children ?? [])
        .map((c) => renderGemtextNode(c, depth))
        .join("");

    case "text":
      return node.value ?? "";

    case "link":
      return `=> ${node.url} ${(node.children ?? []).map((c) => c.value ?? "").join("")}`;

    case "image":
      return `=> ${node.url} ${node.alt ?? ""}`;

    case "list":
      return (node.children ?? [])
        .map((c) => renderGemtextNode(c, depth + 1))
        .join("\n");

    case "listItem":
      return `${indent}* ${(node.children ?? [])
        .map((c) => renderGemtextNode(c, depth + 1))
        .join("")
        .trim()}`;

    case "code":
      return `\`\`\`${node.lang ?? ""}\n${node.value ?? ""}\n\`\`\``;

    case "blockquote":
      return (node.children ?? [])
        .map((c) => {
          const text = renderGemtextNode(c, depth);
          return text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        })
        .join("\n");

    case "section":
    case "header":
    case "main":
    case "aside":
    case "footer":
    case "nav":
    case "article":
      return (node.children ?? [])
        .map((c) => renderGemtextNode(c, depth))
        .join("\n");

    case "time":
      return node.value ?? "";

    case "thematicBreak":
      return "---";

    case "inlineCode":
      return `\`${node.value ?? ""}\``;

    case "strong":
      return `**${(node.children ?? []).map((c) => c.value ?? "").join("")}**`;

    case "emphasis":
      return `*${(node.children ?? []).map((c) => c.value ?? "").join("")}*`;

    case "math":
      return `\`\`\`math\n${node.value ?? ""}\n\`\`\``;

    case "inlineMath":
      return `$${node.value ?? ""}$`;

    case "component":
      return "";

    case "mention":
      return renderMention(node);

    default:
      return "";
  }
}

export function renderGemtext(ir: IrNode): string {
  return renderGemtextNode(ir);
}
