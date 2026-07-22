import type {
  AuthorConfig,
  HypernextConfig,
  OrganizationConfig,
} from "../types/config.js";

const TRAILING_SLASH_RE = /\/$/;
const LEADING_SLASH_RE = /^\//;

function webSiteJsonLd(
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

function contactPointJsonLd(
  contactPoint: OrganizationConfig["contactPoint"]
): Record<string, string> | undefined {
  if (!contactPoint) {
    return;
  }
  const cp: Record<string, string> = { "@type": "ContactPoint" };
  if (contactPoint.email) {
    cp.email = contactPoint.email;
  }
  if (contactPoint.url) {
    cp.url = contactPoint.url;
  }
  return Object.keys(cp).length > 1 ? cp : undefined;
}

function postalAddressJsonLd(
  address: OrganizationConfig["address"]
): Record<string, string> | undefined {
  if (!address) {
    return;
  }
  const addr: Record<string, string> = { "@type": "PostalAddress" };
  if (address.country) {
    addr.addressCountry = address.country;
  }
  if (address.locality) {
    addr.addressLocality = address.locality;
  }
  return Object.keys(addr).length > 1 ? addr : undefined;
}

function organizationJsonLd(
  siteUrl: string,
  siteName: string,
  resolveUrl: (path: string) => string,
  org?: OrganizationConfig
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
    obj.contactPoint = contactPointJsonLd(org.contactPoint);
  }
  if (org.address) {
    obj.address = postalAddressJsonLd(org.address);
  }
  if (org.founders && org.founders.length > 0) {
    obj.founder = org.founders.map((f: string) => ({
      "@type": "Person",
      name: f,
    }));
  }
  return obj;
}

function personJsonLd(
  siteUrl: string,
  resolveUrl: (path: string) => string,
  author: AuthorConfig
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

interface PageJsonLdOptions {
  date: string | undefined;
  description: string;
  featuredImage: string | undefined;
  frontmatter: Record<string, unknown>;
  hasAuthor: boolean;
  postUrl: string;
  siteUrl: string;
  slug: string | undefined;
  title: string;
}

function pageJsonLd(options: PageJsonLdOptions): Record<string, unknown> {
  const {
    siteUrl,
    postUrl,
    title,
    description,
    slug,
    date,
    featuredImage,
    frontmatter,
    hasAuthor,
  } = options;
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

function breadcrumbJsonLd(
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

function imageJsonLd(
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

/** Build a complete JSON-LD graph script tag from frontmatter + config */
export function buildJsonLd(
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
  const featuredImage = frontmatter.featuredImage as string | undefined;
  const hasAuthor = !!config.author?.name;

  const resolveUrl = (path: string): string =>
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${siteUrl}/${path.replace(LEADING_SLASH_RE, "")}`;

  const graph: Record<string, unknown>[] = [
    webSiteJsonLd(siteUrl, siteName, description, config),
    organizationJsonLd(siteUrl, siteName, resolveUrl, config.site.organization),
  ];

  const person = personJsonLd(siteUrl, resolveUrl, config.author);
  if (person) {
    graph.push(person);
  }

  graph.push(
    pageJsonLd({
      siteUrl,
      postUrl,
      title,
      description,
      slug,
      date,
      featuredImage,
      frontmatter,
      hasAuthor,
    }),
    breadcrumbJsonLd(siteUrl, postUrl, title, slug)
  );

  if (featuredImage) {
    graph.push(imageJsonLd(siteUrl, featuredImage, frontmatter, hasAuthor));
  }

  const cleanGraph = graph.map((entry) =>
    Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))
  );

  return `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@graph": cleanGraph }, null, 2)}
</script>`;
}

/** Build a standalone JSON-LD script tag for a page/article */
export function buildJsonLdPage(
  config: HypernextConfig,
  slug: string,
  title: string,
  description: string,
  date?: string,
  image?: string,
  imageAlt?: string
): string {
  const siteUrl = config.site.canonicalBase.replace(TRAILING_SLASH_RE, "");
  const postUrl = `${siteUrl}/${slug}`;
  const hasAuthor = !!config.author?.name;

  const page = pageJsonLd({
    siteUrl,
    postUrl,
    title,
    description,
    slug,
    date,
    featuredImage: image,
    frontmatter: { featuredImageAlt: imageAlt },
    hasAuthor,
  });

  return `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", ...page }, null, 2)}
</script>`;
}

/** Build a standalone JSON-LD script tag for the website */
export function buildJsonLdWebsite(config: HypernextConfig): string {
  const siteUrl = config.site.canonicalBase.replace(TRAILING_SLASH_RE, "");
  const siteName = config.site.meta.title;
  const description = config.site.meta.description;

  const site = webSiteJsonLd(siteUrl, siteName, description, config);

  return `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", ...site }, null, 2)}
</script>`;
}
