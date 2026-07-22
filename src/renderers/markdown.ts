import type { IrNode } from "../parser/ir.js";

type MdRenderer = (node: IrNode) => string;

function renderMention(node: IrNode): string {
  const lines: string[] = [];
  if (node.authorName) {
    lines.push(
      `> **${node.authorName}**${node.platform ? ` via ${node.platform}` : ""}`
    );
  }
  if (node.content) {
    for (const line of node.content.split("\n")) {
      lines.push(`> ${line}`);
    }
  }
  if (node.sourceUrl) {
    lines.push(`> [Permalink](${node.sourceUrl})`);
  }
  return lines.join("\n");
}

const MD_RENDERERS: Record<string, MdRenderer> = {
  root(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  heading(node) {
    const prefix = "#".repeat(node.depth ?? 1);
    return `${prefix} ${renderMdChildren(node)}`;
  },
  paragraph(node) {
    return renderMdChildren(node);
  },
  text(node) {
    return node.value ?? "";
  },
  link(node) {
    return `[${renderMdChildren(node)}](${node.url ?? ""})`;
  },
  image(node) {
    return `![${node.alt ?? ""}](${node.url ?? ""})`;
  },
  list(node) {
    return (node.children ?? []).map(renderMdNode).join("\n");
  },
  listItem(node) {
    return `- ${renderMdChildren(node).trim()}`;
  },
  code(node) {
    return `\`\`\`${node.lang ?? ""}\n${node.value ?? ""}\n\`\`\``;
  },
  blockquote(node) {
    return (node.children ?? [])
      .map((c) =>
        renderMdNode(c)
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
      )
      .join("\n");
  },
  section(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  article(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  header(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  main(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  aside(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  footer(node) {
    return (node.children ?? []).map(renderMdNode).join("\n\n");
  },
  nav(node) {
    return (node.children ?? []).map(renderMdNode).join("\n");
  },
  time(node) {
    return node.value ?? "";
  },
  thematicBreak() {
    return "---";
  },
  inlineCode(node) {
    return `\`${node.value ?? ""}\``;
  },
  strong(node) {
    return `**${renderMdChildren(node)}**`;
  },
  emphasis(node) {
    return `*${renderMdChildren(node)}*`;
  },
  delete(node) {
    return `~~${renderMdChildren(node)}~~`;
  },
  table(node) {
    return (node.children ?? []).map(renderMdNode).join("\n");
  },
  tableRow(node) {
    return `| ${renderMdChildren(node)} |`;
  },
  tableCell(node) {
    return renderMdChildren(node);
  },
  math(node) {
    return `$$\n${node.value ?? ""}\n$$`;
  },
  inlineMath(node) {
    return `$${node.value ?? ""}$`;
  },
  component() {
    return "";
  },
  mention: renderMention,
};

function renderMdChildren(node: IrNode): string {
  return (node.children ?? []).map(renderMdNode).join("");
}

function renderMdNode(node: IrNode): string {
  const renderer = MD_RENDERERS[node.type];
  return renderer ? renderer(node) : "";
}

export function renderMarkdown(ir: IrNode): string {
  return renderMdNode(ir);
}
