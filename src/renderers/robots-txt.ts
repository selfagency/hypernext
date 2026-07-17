import type { AgentRobotsTxtRule, HypernextConfig } from "../types/config.js";

const AI_CRAWLERS_BLOCK = [
  "AdsBot-Google",
  "Amazonbot",
  "anthropic-ai",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ChatGPT-User",
  "Claude-Web",
  "ClaudeBot",
  "cohere-ai",
  "DataForSeoBot",
  "Diffbot",
  "FacebookBot",
  "Google-Extended",
  "GPTBot",
  "ImagesiftBot",
  "magpie-crawler",
  "Meltwater",
  "Meta-ExternalAgent",
  "omgili",
  "Omgilibot",
  "PerplexityBot",
  "PetalBot",
  "Scrapy",
  "SemrushBot",
  "Sidetrade indexer bot",
  "Timpibot",
  "VelenPublicWebCrawler",
  "Webzio-Extended",
];

const AI_CRAWLERS_SELECTIVE = [
  "anthropic-ai",
  "Claude-Web",
  "ClaudeBot",
  "GPTBot",
  "Google-Extended",
  "CCBot",
  "PerplexityBot",
];

function getAiCrawlers(aiCrawlers: string): string[] {
  if (aiCrawlers === "block") {
    return AI_CRAWLERS_BLOCK;
  }
  if (aiCrawlers === "selective") {
    return AI_CRAWLERS_SELECTIVE;
  }
  return [];
}

function renderAiCrawlerRules(lines: string[], config: HypernextConfig): void {
  const robotsConfig = config.robotsTxt;
  if (robotsConfig?.enabled === false) {
    return;
  }

  const aiPolicy = robotsConfig?.aiCrawlers ?? "block";
  for (const crawler of getAiCrawlers(aiPolicy)) {
    lines.push(`User-agent: ${crawler}`);
    lines.push("Disallow: /");
    lines.push("");
  }

  renderContentSignal(lines, config);
}

function renderContentSignal(lines: string[], config: HypernextConfig): void {
  const cs = config.robotsTxt?.contentSignals;
  if (!cs?.enabled) {
    return;
  }

  const parts: string[] = [];
  if (cs.aiTrain !== undefined) {
    parts.push(`ai-train=${cs.aiTrain ? "yes" : "no"}`);
  }
  if (cs.search !== undefined) {
    parts.push(`search=${cs.search ? "yes" : "no"}`);
  }
  if (cs.aiInput !== undefined) {
    parts.push(`ai-input=${cs.aiInput ? "yes" : "no"}`);
  }
  if (parts.length > 0) {
    lines.push("User-agent: *");
    lines.push(`Content-Signal: ${parts.join(", ")}`);
    lines.push("Allow: /");
    lines.push("");
  }
}

function renderCustomRules(lines: string[], rules: AgentRobotsTxtRule[]): void {
  for (const rule of rules) {
    lines.push(`User-agent: ${rule.userAgent}`);
    if (rule.allow) {
      for (const path of rule.allow) {
        lines.push(`Allow: ${path}`);
      }
    }
    if (rule.disallow) {
      for (const path of rule.disallow) {
        lines.push(`Disallow: ${path}`);
      }
    }
    if (rule.crawlDelay !== undefined) {
      lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    }
    lines.push("");
  }
}

export function renderRobotsTxt(config: HypernextConfig): string {
  const lines: string[] = [];

  lines.push("# robots.txt for Hypernext");
  lines.push(`# Host: ${new URL(config.site.canonicalBase).host}`);
  lines.push("");

  renderAiCrawlerRules(lines, config);

  if (config.robotsTxt?.rules) {
    renderCustomRules(lines, config.robotsTxt.rules);
  }

  lines.push(`Sitemap: ${config.site.canonicalBase}/sitemap.xml`);
  lines.push("");

  return lines.join("\n");
}
