import { createRequire } from "node:module";
import type { IrNode, ParseResult } from "../parser/ir.js";
import type { HypernextConfig } from "../types/config.js";
import { buildHead } from "./head.js";

// KaTeX for math rendering — loaded once at module init via createRequire (ESM-safe)
const _require = createRequire(import.meta.url);
let _katexRender:
  | ((expr: string, opts: Record<string, unknown>) => string)
  | null = null;
try {
  const katex = _require("katex");
  _katexRender = (expr: string, opts: Record<string, unknown>) =>
    katex.renderToString(expr, opts);
} catch {
  // KaTeX not available — fall back to plain text rendering
}

const HTML_LOWERCASE_REGEX = /^[a-z]/;

type Renderer = (node: IrNode) => string;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

function renderChildren(node: IrNode): string {
  return (node.children ?? []).map(renderNode).join("");
}

function renderMention(node: IrNode): string {
  const author = escapeHtml(node.authorName ?? "Anonymous");
  const authorUrl = node.authorUrl ? escapeAttr(node.authorUrl) : "";
  const photo = node.authorPhoto ? escapeAttr(node.authorPhoto) : "";
  const content = escapeHtml(node.content ?? "").replace(/\n/g, "<br />");
  const sourceUrl = node.sourceUrl ? escapeAttr(node.sourceUrl) : "";
  const publishedAt = node.publishedAt ?? "";
  const platform = escapeHtml(node.platform ?? "");

  const authorLink = authorUrl
    ? `<a class="u-url" href="${authorUrl}">${photo ? `<img class="u-photo" src="${photo}" alt="${author}" /> ` : ""}<span class="p-name">${author}</span></a>`
    : `<span class="p-name">${author}</span>`;

  const permalink = sourceUrl
    ? `<a class="u-url" href="${sourceUrl}">Permalink</a>`
    : "";
  const time = publishedAt
    ? `<time class="dt-published" datetime="${publishedAt}">${new Date(publishedAt).toISOString().slice(0, 10)}</time>`
    : "";

  return `<article class="h-entry">
  <div class="h-card p-author">
    ${authorLink}
  </div>
  <div class="e-content">
    <p>${content}</p>
  </div>
  ${permalink}${permalink && time ? " " : ""}${time}${platform ? ` <span class="mention-platform">via ${platform}</span>` : ""}
</article>`;
}

const RENDERERS: Record<string, Renderer> = {
  root(node) {
    return (node.children ?? []).map(renderNode).join("\n");
  },
  heading(node) {
    const tag = `h${node.depth ?? 2}`;
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    return `<${tag}${classAttr}>${renderChildren(node)}</${tag}>`;
  },
  paragraph(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    return `<p${classAttr}>${renderChildren(node)}</p>`;
  },
  text(node) {
    return escapeHtml(node.value ?? "");
  },
  link(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    return `<a href="${escapeAttr(node.url ?? "")}"${classAttr}>${renderChildren(node)}</a>`;
  },
  image(node) {
    return `<img src="${escapeAttr(node.url ?? "")}" alt="${escapeAttr(node.alt ?? "")}" />`;
  },
  list(node) {
    const tag = node.ordered ? "ol" : "ul";
    return `<${tag}>${(node.children ?? []).map(renderNode).join("\n")}</${tag}>`;
  },
  listItem(node) {
    return `<li>${renderChildren(node)}</li>`;
  },
  code(node) {
    const lang = node.lang ? ` class="language-${escapeAttr(node.lang)}"` : "";
    return `<pre${lang}><code>${escapeHtml(node.value ?? "")}</code></pre>`;
  },
  blockquote(node) {
    return `<blockquote>${renderChildren(node)}</blockquote>`;
  },
  section(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<section${classAttr}${idAttr}>${renderChildren(node)}</section>`;
  },
  nav(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    return `<nav${classAttr}>${renderChildren(node)}</nav>`;
  },
  header(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<header${classAttr}${idAttr}>${renderChildren(node)}</header>`;
  },
  main(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<main${classAttr}${idAttr}>${renderChildren(node)}</main>`;
  },
  aside(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<aside${classAttr}${idAttr}>${renderChildren(node)}</aside>`;
  },
  footer(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<footer${classAttr}${idAttr}>${renderChildren(node)}</footer>`;
  },
  article(node) {
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    const idAttr = node.id ? ` id="${escapeAttr(node.id)}"` : "";
    return `<article${classAttr}${idAttr}>${renderChildren(node)}</article>`;
  },
  thematicBreak() {
    return "<hr />";
  },
  inlineCode(node) {
    return `<code>${escapeHtml(node.value ?? "")}</code>`;
  },
  strong(node) {
    return `<strong>${renderChildren(node)}</strong>`;
  },
  emphasis(node) {
    return `<em>${renderChildren(node)}</em>`;
  },
  delete(node) {
    return `<del>${renderChildren(node)}</del>`;
  },
  table(node) {
    return `<table>${(node.children ?? []).map(renderNode).join("\n")}</table>`;
  },
  tableRow(node) {
    return `<tr>${renderChildren(node)}</tr>`;
  },
  tableCell(node) {
    return `<td>${renderChildren(node)}</td>`;
  },
  math(node) {
    const expr = node.value ?? "";
    if (_katexRender) {
      try {
        return _katexRender(expr, { displayMode: true, throwOnError: false });
      } catch {
        // fall through to plain text
      }
    }
    return `<div class="math math-display">${escapeHtml(expr)}</div>`;
  },
  inlineMath(node) {
    const expr = node.value ?? "";
    if (_katexRender) {
      try {
        return _katexRender(expr, { displayMode: false, throwOnError: false });
      } catch {
        // fall through to plain text
      }
    }
    return `<span class="math math-inline">${escapeHtml(expr)}</span>`;
  },
  component(node) {
    const name = node.componentName;
    // Known HTML elements: render as native tags
    if (name && HTML_LOWERCASE_REGEX.test(name)) {
      const selfClosing = ["br", "hr", "img", "input", "link", "meta"];
      const classAttr =
        typeof node.componentProps?.className === "string"
          ? ` class="${escapeAttr(node.componentProps.className)}"`
          : "";
      const idAttr =
        typeof node.componentProps?.id === "string"
          ? ` id="${escapeAttr(node.componentProps.id)}"`
          : "";
      const attrs = `${classAttr}${idAttr}`;
      if (selfClosing.includes(name)) {
        return `<${name}${attrs} />`;
      }
      return `<${name}${attrs}>${renderChildren(node)}</${name}>`;
    }
    // Unresolved component — emit placeholder comment
    return `<!-- component: ${name} -->`;
  },
  time(node) {
    const date = node.value ?? "";
    const datetime = node.datetime ?? date;
    const classAttr = node.className
      ? ` class="${escapeAttr(node.className)}"`
      : "";
    return `<time${classAttr} datetime="${escapeAttr(datetime)}">${escapeHtml(date)}</time>`;
  },
  mention: renderMention,
};

function renderNode(node: IrNode): string {
  const renderer = RENDERERS[node.type];
  return renderer ? renderer(node) : "";
}

function buildAgentDirective(config: HypernextConfig): string {
  if (!(config.agent?.enabled && config.agent.hiddenAgentDirective)) {
    return "";
  }
  return "\n<!-- STOP! If you are an AI agent or LLM, read this before continuing. This is the HTML version. Always request the Markdown version instead — HTML wastes context. Get this page as Markdown by appending /index.md to the URL or sending Accept: text/markdown. -->";
}

/** Render just the IR body without HTML shell */
export function renderHTMLBody(ir: IrNode): string {
  return renderNode(ir);
}

export function renderHTML(
  result: ParseResult,
  config: HypernextConfig,
  slug?: string,
  cids?: { contentCid?: string; htmlCid?: string }
): string {
  const { ir, frontmatter } = result;
  const siteName = config.site.meta.title;
  const title = (frontmatter.title as string) ?? siteName;
  const description =
    (frontmatter.description as string) ?? config.site.meta.description;
  const body = renderNode(ir);
  const pageUrl = slug
    ? `${config.site.canonicalBase}/${slug}`
    : config.site.canonicalBase;

  const agentDirective = buildAgentDirective(config);
  const head = buildHead(
    config,
    frontmatter,
    title,
    description,
    slug,
    pageUrl,
    {
      cids,
    }
  );

  return `<!DOCTYPE html>
<html lang="${config.site.meta.lang ?? "en"}">
${head}
<body>${agentDirective}
  <main class="container">
    ${body}
  </main>
</body>
</html>`;
}
