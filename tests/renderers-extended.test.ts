import { describe, expect, it } from "vitest";
import { addContentSignalHeader } from "../src/renderers/content-signals.js";
import { handleMarkdownNegotiation } from "../src/renderers/markdown-negotiation.js";
import { renderRobotsTxt } from "../src/renderers/robots-txt.js";
import { renderSecurityTxt } from "../src/renderers/security-txt.js";
import type { HypernextConfig } from "../src/types/config.js";

const MINIMAL_CONFIG: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Test site", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {},
  taxonomies: [],
  protocols: {
    http: { enabled: true, port: 8080 },
    gemini: { enabled: false, port: 1965 },
    gopher: { enabled: false, port: 70 },
    spartan: { enabled: false, port: 300 },
    nex: { enabled: false, port: 1900 },
    finger: { enabled: false, port: 79 },
    text: { enabled: false, port: 5011 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: false, transport: "stdio" },
};

describe("robots.txt renderer", () => {
  it("renders default robots.txt with AI crawlers blocked", () => {
    const result = renderRobotsTxt(MINIMAL_CONFIG);
    expect(result).toContain("# robots.txt for Hypernext");
    expect(result).toContain("Sitemap: http://localhost:8080/sitemap.xml");
    expect(result).toContain("User-agent: GPTBot");
    expect(result).toContain("Disallow: /");
  });

  it("renders selective AI crawler block", () => {
    const config: HypernextConfig = {
      ...MINIMAL_CONFIG,
      robotsTxt: { enabled: true, aiCrawlers: "selective", rules: [] },
    };
    const result = renderRobotsTxt(config);
    expect(result).toContain("User-agent: GPTBot");
    expect(result).not.toContain("User-agent: Bytespider");
  });

  it("renders allow AI crawlers", () => {
    const config: HypernextConfig = {
      ...MINIMAL_CONFIG,
      robotsTxt: { enabled: true, aiCrawlers: "allow", rules: [] },
    };
    const result = renderRobotsTxt(config);
    expect(result).not.toContain("User-agent: GPTBot");
  });

  it("includes custom rules", () => {
    const config: HypernextConfig = {
      ...MINIMAL_CONFIG,
      robotsTxt: {
        enabled: true,
        aiCrawlers: "allow",
        rules: [
          {
            userAgent: "MyBot",
            allow: ["/public"],
            disallow: ["/private"],
            crawlDelay: 10,
          },
        ],
      },
    };
    const result = renderRobotsTxt(config);
    expect(result).toContain("User-agent: MyBot");
    expect(result).toContain("Allow: /public");
    expect(result).toContain("Disallow: /private");
    expect(result).toContain("Crawl-delay: 10");
  });

  it("includes content signal when enabled", () => {
    const config: HypernextConfig = {
      ...MINIMAL_CONFIG,
      contentSignals: {
        enabled: true,
        aiTrain: false,
        search: true,
        aiInput: false,
      },
    };
    const result = renderRobotsTxt(config);
    expect(result).toContain("Content-Signal:");
    expect(result).toContain("ai-train=no");
    expect(result).toContain("search=yes");
  });
});

describe("security.txt renderer", () => {
  it("returns empty string when no contact or expires", () => {
    expect(renderSecurityTxt({ contact: [], expires: "" })).toBe("");
  });

  it("renders full security.txt", () => {
    const result = renderSecurityTxt({
      contact: ["mailto:security@example.com"],
      expires: "2026-12-31T00:00:00Z",
      encryption: "https://example.com/pgp-key.txt",
      acknowledgments: "https://example.com/hall-of-fame",
      preferredLanguages: "en, fr",
      canonical: ["https://example.com/.well-known/security.txt"],
      policy: "https://example.com/security-policy",
      hiring: "https://example.com/jobs",
      csaf: "https://example.com/csaf",
    });
    expect(result).toContain("Contact: mailto:security@example.com");
    expect(result).toContain("Expires: 2026-12-31T00:00:00Z");
    expect(result).toContain("Encryption: https://example.com/pgp-key.txt");
    expect(result).toContain(
      "Acknowledgments: https://example.com/hall-of-fame"
    );
    expect(result).toContain("Preferred-Languages: en, fr");
    expect(result).toContain(
      "Canonical: https://example.com/.well-known/security.txt"
    );
    expect(result).toContain("Policy: https://example.com/security-policy");
    expect(result).toContain("Hiring: https://example.com/jobs");
    expect(result).toContain("CSAF: https://example.com/csaf");
  });
});

describe("content-signals header", () => {
  it("adds Content-Signal header when enabled", () => {
    const headers: Record<string, string> = {};
    const reply = {
      header: (key: string, value: string) => {
        headers[key] = value;
      },
    } as any;

    addContentSignalHeader(reply, {
      ...MINIMAL_CONFIG,
      contentSignals: {
        enabled: true,
        aiTrain: false,
        search: true,
        aiInput: false,
      },
    });

    expect(headers["Content-Signal"]).toBe(
      "ai-train=no, search=yes, ai-input=no"
    );
  });

  it("does not add header when disabled", () => {
    const headers: Record<string, string> = {};
    const reply = {
      header: (key: string, value: string) => {
        headers[key] = value;
      },
    } as any;

    addContentSignalHeader(reply, MINIMAL_CONFIG);
    expect(headers["Content-Signal"]).toBeUndefined();
  });
});

describe("markdown negotiation", () => {
  it("returns false when agent is not enabled", () => {
    const result = handleMarkdownNegotiation(
      { headers: { accept: "text/markdown" } } as any,
      {} as any,
      MINIMAL_CONFIG,
      "test",
      "# Hello"
    );
    expect(result).toBe(false);
  });

  it("returns false when accept header does not include text/markdown", () => {
    const config: HypernextConfig = {
      ...MINIMAL_CONFIG,
      agent: {
        enabled: true,
        markdownNegotiation: true,
        llmsTxt: false,
        sitemap: false,
        linkHeaders: false,
        hiddenAgentDirective: false,
        viewTransitions: false,
        wellKnown: {
          apiCatalog: false,
          agentSkills: false,
          mcpServerCard: false,
          webBotAuth: false,
          webmcp: false,
        },
      },
    };
    const result = handleMarkdownNegotiation(
      { headers: { accept: "text/html" } } as any,
      {} as any,
      config,
      "test",
      "# Hello"
    );
    expect(result).toBe(false);
  });
});
