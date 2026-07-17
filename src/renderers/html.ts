import type { IrNode, ParseResult } from "../parser/ir.js";
import type { HypernextConfig } from "../types/config.js";

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
    return `<${tag}>${renderChildren(node)}</${tag}>`;
  },
  paragraph(node) {
    return `<p>${renderChildren(node)}</p>`;
  },
  text(node) {
    return escapeHtml(node.value ?? "");
  },
  link(node) {
    return `<a href="${escapeAttr(node.url ?? "")}">${renderChildren(node)}</a>`;
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
    return `<div class="math math-display">${escapeHtml(node.value ?? "")}</div>`;
  },
  inlineMath(node) {
    return `<span class="math math-inline">${escapeHtml(node.value ?? "")}</span>`;
  },
  component(node) {
    return `<!-- component: ${node.componentName} -->`;
  },
  mention: renderMention,
};

function renderNode(node: IrNode): string {
  const renderer = RENDERERS[node.type];
  return renderer ? renderer(node) : "";
}

export function renderHTML(
  result: ParseResult,
  config: HypernextConfig,
  slug?: string
): string {
  const { ir, frontmatter } = result;
  const title = (frontmatter.title as string) ?? config.site.meta.title;
  const description =
    (frontmatter.description as string) ?? config.site.meta.description;
  const canonicalUrl =
    (frontmatter.canonicalUrl as string) ?? config.site.canonicalBase;
  const cssPath = config.site.theme?.cssPath ?? "";
  const body = renderNode(ir);
  const date = frontmatter.date as string | undefined;
  const publishedTime = date
    ? `<time class="dt-published" datetime="${escapeAttr(date)}">${escapeHtml(date)}</time>`
    : "";
  const postUrl = slug ? `${config.site.canonicalBase}/${slug}` : "";
  const postPermalink = slug
    ? `<a class="u-url" href="${escapeAttr(postUrl)}">Permalink</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="${config.site.meta.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}" />
  ${cssPath ? `<link rel="stylesheet" href="${escapeAttr(cssPath)}" />` : ""}
</head>
<body>
  <article class="h-entry">
    <h1 class="p-name">${escapeHtml(title)}</h1>
    ${publishedTime}
    ${frontmatter.author ? `<p class="p-author h-card">${escapeHtml(String(frontmatter.author))}</p>` : ""}
    <div class="e-content">
      ${body}
    </div>
    ${postPermalink}
  </article>
</body>
</html>`;
}
