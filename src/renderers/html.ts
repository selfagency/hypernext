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

const TRAILING_SLASH_RE = /\/$/;
const LEADING_SLASH_RE = /^\//;

function buildJsonLdWebSite(
  siteUrl: string,
  siteName: string,
  description: string,
  config: HypernextConfig
): Record<string, unknown> {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: siteName,
    description,
    inLanguage: config.site.meta.lang,
    publisher: { "@id": `${siteUrl}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

function buildContactPoint(
  contactPoint: NonNullable<typeof config.site.organization>["contactPoint"]
): Record<string, string> | undefined {
  const cp: Record<string, string> = { "@type": "ContactPoint" };
  if (contactPoint.email) {
    cp.email = contactPoint.email;
  }
  if (contactPoint.url) {
    cp.url = contactPoint.url;
  }
  return Object.keys(cp).length > 1 ? cp : undefined;
}

function buildPostalAddress(
  address: NonNullable<typeof config.site.organization>["address"]
): Record<string, string> | undefined {
  const addr: Record<string, string> = { "@type": "PostalAddress" };
  if (address.country) {
    addr.addressCountry = address.country;
  }
  if (address.locality) {
    addr.addressLocality = address.locality;
  }
  return Object.keys(addr).length > 1 ? addr : undefined;
}

function buildJsonLdOrganization(
  siteUrl: string,
  siteName: string,
  resolveUrl: (path: string) => string,
  org?: typeof config.site.organization
): Record<string, unknown> {
  if (!org) {
    return {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: siteName,
      url: siteUrl,
    };
  }
  const obj: Record<string, unknown> = {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: org.name,
    url: org.url ?? siteUrl,
  };
  if (org.logo) {
    obj.logo = { "@type": "ImageObject", url: resolveUrl(org.logo) };
  }
  if (org.sameAs && org.sameAs.length > 0) {
    obj.sameAs = org.sameAs;
  }
  if (org.contactPoint) {
    obj.contactPoint = buildContactPoint(org.contactPoint);
  }
  if (org.address) {
    obj.address = buildPostalAddress(org.address);
  }
  if (org.founders && org.founders.length > 0) {
    obj.founder = org.founders.map((f) => ({
      "@type": "Person",
      name: f,
    }));
  }
  return obj;
}

function buildJsonLdPerson(
  siteUrl: string,
  resolveUrl: (path: string) => string,
  author: typeof config.author
): Record<string, unknown> | null {
  if (!author?.name) {
    return null;
  }
  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": `${siteUrl}/#person`,
    name: author.name,
    url: author.url ?? siteUrl,
  };
  if (author.photo) {
    person.image = { "@type": "ImageObject", url: resolveUrl(author.photo) };
  }
  if (author.bio) {
    person.description = author.bio;
  }
  if (author.socials) {
    const sameAs: string[] = [];
    for (const url of Object.values(author.socials)) {
      if (url) {
        sameAs.push(url);
      }
    }
    if (sameAs.length > 0) {
      person.sameAs = sameAs;
    }
  }
  return person;
}

function buildJsonLdPage(
  siteUrl: string,
  postUrl: string,
  title: string,
  description: string,
  slug: string | undefined,
  date: string | undefined,
  featuredImage: string | undefined,
  frontmatter: Record<string, unknown>,
  hasAuthor: boolean
): Record<string, unknown> {
  const pageType = slug === undefined ? "WebPage" : "BlogPosting";
  const page: Record<string, unknown> = {
    "@type": pageType,
    "@id": postUrl,
    url: postUrl,
    name: title,
    headline: title,
    description,
    inLanguage: "en",
    isPartOf: { "@id": `${siteUrl}/#website` },
    breadcrumb: { "@id": `${siteUrl}/#breadcrumb` },
    publisher: { "@id": `${siteUrl}/#organization` },
    mainEntityOfPage: { "@id": postUrl },
  };
  if (hasAuthor) {
    page.author = { "@id": `${siteUrl}/#person` };
  }
  if (date) {
    page.datePublished = date;
    page.dateModified = date;
  }
  if (featuredImage) {
    const img: Record<string, string> = {
      "@type": "ImageObject",
      url: `${siteUrl}/${featuredImage.replace(LEADING_SLASH_RE, "")}`,
    };
    if (frontmatter.featuredImageAlt) {
      img.caption = frontmatter.featuredImageAlt as string;
    }
    page.image = img;
  }
  return Object.fromEntries(
    Object.entries(page).filter(([, v]) => v !== undefined)
  );
}

function buildJsonLdBreadcrumb(
  siteUrl: string,
  postUrl: string,
  title: string,
  slug: string | undefined
): Record<string, unknown> {
  const items: Record<string, unknown>[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
  ];
  if (slug) {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: title,
      item: postUrl,
    });
  }
  return {
    "@type": "BreadcrumbList",
    "@id": `${siteUrl}/#breadcrumb`,
    itemListElement: items,
  };
}

function buildJsonLdImage(
  siteUrl: string,
  featuredImage: string,
  frontmatter: Record<string, unknown>,
  hasAuthor: boolean
): Record<string, unknown> {
  const url = `${siteUrl}/${featuredImage.replace(LEADING_SLASH_RE, "")}`;
  const img: Record<string, unknown> = {
    "@type": "ImageObject",
    "@id": `${siteUrl}/#featured-image`,
    url,
    contentUrl: url,
  };
  if (frontmatter.featuredImageAlt) {
    img.caption = frontmatter.featuredImageAlt as string;
  }
  if (hasAuthor) {
    img.author = { "@id": `${siteUrl}/#person` };
  }
  return img;
}

function buildJsonLd(
  config: HypernextConfig,
  frontmatter: Record<string, unknown>,
  slug?: string
): string {
  const siteUrl = config.site.canonicalBase.replace(TRAILING_SLASH_RE, "");
  const siteName = config.site.meta.title;
  const title = (frontmatter.title as string) ?? siteName;
  const description =
    (frontmatter.description as string) ?? config.site.meta.description;
  const postUrl = slug ? `${siteUrl}/${slug}` : siteUrl;
  const date = frontmatter.date as string | undefined;
  const author = config.author ?? {};
  const featuredImage = frontmatter.featuredImage as string | undefined;
  const hasAuthor = !!author.name;

  function resolveUrl(path: string): string {
    return path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${siteUrl}/${path.replace(LEADING_SLASH_RE, "")}`;
  }

  const graph: Record<string, unknown>[] = [
    buildJsonLdWebSite(siteUrl, siteName, description, config),
    buildJsonLdOrganization(
      siteUrl,
      siteName,
      resolveUrl,
      config.site.organization
    ),
  ];

  const person = buildJsonLdPerson(siteUrl, resolveUrl, config.author);
  if (person) {
    graph.push(person);
  }

  graph.push(
    buildJsonLdPage(
      siteUrl,
      postUrl,
      title,
      description,
      slug,
      date,
      featuredImage,
      frontmatter,
      hasAuthor
    ),
    buildJsonLdBreadcrumb(siteUrl, postUrl, title, slug)
  );

  if (featuredImage) {
    graph.push(
      buildJsonLdImage(siteUrl, featuredImage, frontmatter, hasAuthor)
    );
  }

  const cleanGraph = graph.map((entry) =>
    Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))
  );

  return `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": cleanGraph }, null, 2)}
</script>`;
}

function resolveMeta(
  frontmatter: Record<string, unknown>,
  config: HypernextConfig,
  key: string,
  configKey?: string
): string | undefined {
  const fm = frontmatter[key] as string | undefined;
  if (fm) {
    return fm;
  }
  const cfg =
    config.site.meta[configKey ?? (key as keyof typeof config.site.meta)];
  return cfg as string | undefined;
}

function renderFeaturedImage(frontmatter: Record<string, unknown>): string {
  const src = frontmatter.featuredImage as string | undefined;
  if (!src) {
    return "";
  }
  const alt = escapeAttr(
    (frontmatter.featuredImageAlt as string) ?? "Featured image"
  );
  const caption = frontmatter.featuredImageCaption as string | undefined;
  const img = `<img class="featured-image u-featured" src="${escapeAttr(src)}" alt="${alt}" />`;
  if (caption) {
    return `<figure class="featured-image">${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  }
  return img;
}

export function renderHTML(
  result: ParseResult,
  config: HypernextConfig,
  slug?: string
): string {
  const { ir, frontmatter } = result;
  const siteName = config.site.meta.title;
  const title = (frontmatter.title as string) ?? siteName;
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
  const postUrl = slug
    ? `${config.site.canonicalBase}/${slug}`
    : config.site.canonicalBase;
  const postPermalink = slug
    ? `<a class="u-url" href="${escapeAttr(postUrl)}">Permalink</a>`
    : "";

  // OG meta resolution
  const ogTitle =
    resolveMeta(frontmatter, config, "ogTitle", "ogTitle") ?? title;
  const ogDescription =
    resolveMeta(frontmatter, config, "ogDescription", "ogDescription") ??
    description;
  const ogImage =
    resolveMeta(frontmatter, config, "ogImage", "ogImage") ??
    (frontmatter.featuredImage as string | undefined);
  const ogImageAlt =
    resolveMeta(frontmatter, config, "ogImageAlt", "ogImageAlt") ??
    (frontmatter.featuredImageAlt as string | undefined);
  const ogType = slug ? "article" : "website";

  const ogTags = [
    `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`,
    `<meta property="og:description" content="${escapeAttr(ogDescription)}" />`,
    `<meta property="og:url" content="${escapeAttr(postUrl)}" />`,
    `<meta property="og:type" content="${ogType}" />`,
    `<meta property="og:site_name" content="${escapeAttr(siteName)}" />`,
  ];
  if (ogImage) {
    ogTags.push(
      `<meta property="og:image" content="${escapeAttr(ogImage)}" />`
    );
    if (ogImageAlt) {
      ogTags.push(
        `<meta property="og:image:alt" content="${escapeAttr(ogImageAlt)}" />`
      );
    }
  }

  const featuredImage = renderFeaturedImage(frontmatter);

  return `<!DOCTYPE html>
<html lang="${config.site.meta.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeAttr(canonicalUrl)}" />
  ${ogTags.join("\n  ")}
  ${buildJsonLd(config, frontmatter, slug)}
  ${cssPath ? `<link rel="stylesheet" href="${escapeAttr(cssPath)}" />` : ""}
</head>
<body>
  <article class="h-entry">
    <h1 class="p-name">${escapeHtml(title)}</h1>
    ${publishedTime}
    ${frontmatter.author ? `<p class="p-author h-card">${escapeHtml(String(frontmatter.author))}</p>` : ""}
    ${featuredImage}
    <div class="e-content">
      ${body}
    </div>
    ${postPermalink}
  </article>
</body>
</html>`;
}
