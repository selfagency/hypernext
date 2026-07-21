import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type { CliOptions, HypernextConfig } from "./types/config.js";
import { deepMerge } from "./utils/deep-merge.js";
import { substituteEnvInYaml } from "./utils/env.js";

export const DEFAULT_CONFIG_PATH = "config.yml";

export const DEFAULT_CONFIG_YAML = `site:
  canonicalBase: "http://localhost:8080"
  meta:
    title: "My Hypernext Site"
    description: "A multi-protocol blog and static content library."
    lang: "en"
  theme:
    cssPath: "./assets/style.css"
  pdf:
    enabled: true
    cssPath: "./assets/pdf-style.css"
  ebooks:
    enabled: true
  metadata:
    - name: readTime
      label: "Reading Time"
      type: number
    - name: difficulty
      label: "Difficulty"
      type: string
      options: [beginner, intermediate, advanced]
    - name: featured
      label: "Featured"
      type: boolean
    - name: series
      label: "Series"
      type: string

author:
  name: "Anonymous"
  bio: "Hypernext author."

storage:
  type: local
  local:
    path: "./content"

database:
  type: sqlite
  path: "./db/hypernext.db"

api:
  enabled: true

collections:
  blog:
    path: "/blog/"
    syndicate: true
    rss: true
    layout: "blog.mdx"
  library:
    path: "/library/"
    syndicate: false
    rss: false
    layout: "library.mdx"

taxonomies:
  - name: tags
    plural: tags
    singular: tag
  - name: categories
    plural: categories
    singular: category

protocols:
  http:
    enabled: true
    port: 8080
  gemini:
    enabled: true
    port: 1965
  gopher:
    enabled: true
    port: 70
  spartan:
    enabled: true
    port: 300
  nex:
    enabled: true
    port: 1900
  finger:
    enabled: true
    port: 79
  text:
    enabled: true
    port: 5011

micropub:
  enabled: true

syndication: {}

email:
  enabled: true
  mailpit: true
  from:
    name: "Hypernext"
    address: "noreply@localhost"
  replyTo: "noreply@localhost"
  subjectPrefix: "[Hypernext]"
  transport: smtp
  smtp:
    host: localhost
    port: 1025
    secure: false
    user: ""
    pass: ""
  newsletter:
    digestSchedule: "0 8 * * 1"
    digestTime: "08:00"
  contactForm:
    enabled: false
    recipient: ""
    akismet: false
    captcha: false

comments:
  enabled: true
  inbound:
    webmention: true
    pingback: true
    trackback: false
  aggregation:
    mastodon: true
    bluesky: true
    cacheTtl: 900
  akismet:
    enabled: true

mcp:
  enabled: true
  transport: stdio

ai:
  enabled: false
  openai:
    baseUrl: "http://localhost:11434/v1"
    apiKey: ""
  models:
    embedding: "nomic-embed-text-v2-moe:latest"
    utility: "llama3.2:1b"
    vision: "llava:7b"
    reasoning: "llama3.1:8b"
  vectorDimensions: 768
  features:
    altText: true
    autoTagging: true
    seoMeta: true
    moderation: true

robotsTxt:
  enabled: true
  aiCrawlers: block
  rules: []

contentSignals:
  enabled: true
  aiTrain: false
  search: true
  aiInput: false

securityTxt:
  contact: []
  expires: ""

agent:
  enabled: false
  markdownNegotiation: true
  llmsTxt: true
  sitemap: true
  linkHeaders: true
  wellKnown:
    apiCatalog: true
    agentSkills: true
    mcpServerCard: true
    webBotAuth: true
    webmcp: true
  hiddenAgentDirective: true
  viewTransitions: true

ipfs:
  enabled: false
  apiEndpoint: "http://127.0.0.1:5001"
  gatewayUrl: "https://ipfs.io/ipfs"
  pinning: true
  cacheHtml: true
`;

export function scaffoldDefaults(cwd: string): void {
  const configPath = path.join(cwd, DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, DEFAULT_CONFIG_YAML);
  }

  fs.mkdirSync(path.join(cwd, "content/blog"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "assets"), { recursive: true });

  const welcomePath = path.join(cwd, "content/blog/welcome.mdx");
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(
      welcomePath,
      "---\ntitle: Welcome\ndate: 2026-07-16\ntype: post\ntags: [hypernext]\n---\n\nWelcome to Hypernext!\n"
    );
  }

  const cssPath = path.join(cwd, "assets/style.css");
  if (!fs.existsSync(cssPath)) {
    fs.writeFileSync(
      cssPath,
      "body { font-family: sans-serif; line-height: 1.6; max-width: 70ch; margin: 0 auto; padding: 1rem; }\n"
    );
  }
}

export function validateConfig(config: HypernextConfig): void {
  const required = ["site", "storage", "database"] as const;
  for (const key of required) {
    if (config[key] === undefined || config[key] === null) {
      throw new Error(`Missing required config key: ${key}`);
    }
  }

  if (!config.site?.canonicalBase) {
    throw new Error("Missing required config value: site.canonicalBase");
  }
}

export function loadConfig(configPath: string): HypernextConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  const substituted = substituteEnvInYaml(raw);
  const parsed = yaml.parse(substituted) as HypernextConfig;
  validateConfig(parsed);
  return parsed;
}

export function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function mergeCliOverrides(
  config: HypernextConfig,
  options: CliOptions
): HypernextConfig {
  const overrides: Partial<HypernextConfig> = {};

  if (options.port !== undefined) {
    overrides.protocols = {
      ...config.protocols,
      http: { ...config.protocols.http, port: options.port },
    };
  }

  for (const proto of [
    "http",
    "gemini",
    "gopher",
    "spartan",
    "nex",
    "finger",
    "text",
  ] as const) {
    const val = options[proto];
    if (val !== undefined) {
      overrides.protocols = {
        ...(overrides.protocols ?? config.protocols),
        [proto]: { ...config.protocols[proto], enabled: val },
      };
    }
  }

  if (options.mcp !== undefined) {
    overrides.mcp = {
      ...config.mcp,
      enabled: options.mcp,
    };
  }

  // Read JWT secret from env var
  if (process.env.HYPERNEXT_JWT_SECRET) {
    overrides.jwtSecret = process.env.HYPERNEXT_JWT_SECRET;
  }

  return deepMerge(
    config as unknown as Record<string, unknown>,
    overrides as unknown as Record<string, unknown>
  ) as unknown as HypernextConfig;
}

export function getConfig(cwd: string, options: CliOptions): HypernextConfig {
  const configPath = path.resolve(cwd, options.config ?? DEFAULT_CONFIG_PATH);

  // Load .env file before config so ${VAR} substitution works
  loadEnvFile(path.resolve(cwd, ".env"));

  if (!fs.existsSync(configPath)) {
    scaffoldDefaults(cwd);
  }

  const config = loadConfig(configPath);
  return mergeCliOverrides(config, options);
}
