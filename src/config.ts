import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { DEFAULT_TEMPLATES } from "./constants/default-templates.js";
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

indieauth:
  enabled: true

syndication:
  nostr:
    enabled: false
    relays: []
    signer:
      type: nsec
      encryptedNsec: ""
    profile:
      name: "Hypernext"
    publishProfileOnStart: false
    announceOnFirstPublish: false
    subscribeReplies: false

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
  waline:
    enabled: false
    mode: embedded
    storage:
      type: sqlite
      path: ./db/waline.db
    auth:
      anonymous: true
      login: disable
      registration: closed
    notifications: {}
    antiSpam:
      akismet: true
      ipqps: 60
      audit: false
      secureDomains: []
    markdown:
      emoji: true
      highlight: true
      tex: false
    pageview:
      enabled: false
      replaceNative: false
    port: 8360

mcp: {}

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

  // Scaffold writable copies of default templates into the user's project
  const templatesDir = path.join(cwd, "templates");
  fs.mkdirSync(templatesDir, { recursive: true });
  for (const tmpl of DEFAULT_TEMPLATES) {
    const tmplPath = path.join(templatesDir, tmpl.filename);
    if (!fs.existsSync(tmplPath)) {
      fs.writeFileSync(tmplPath, tmpl.content);
    }
  }
}

const WSS_RE = /^wss:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i;
const HASHTAG_RE = /^[a-z0-9_]+$/i;
const BUNKER_URI_RE = /^(nostrconnect|bunker):\/\/.+/;
// biome-ignore lint: reason
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

  // Nostr syndication validation
  const nostr = config.syndication?.nostr;
  if (nostr?.enabled) {
    if (!nostr.relays || nostr.relays.length === 0) {
      throw new Error(
        "nostr.enabled: true requires at least one relay in syndication.nostr.relays"
      );
    }
    for (const relay of nostr.relays) {
      if (!WSS_RE.test(relay)) {
        throw new Error(
          `Invalid relay URL "${relay}": must be a valid wss:// URL`
        );
      }
    }
    if (nostr.signer.type === "nsec") {
      if (!nostr.signer.encryptedNsec) {
        throw new Error(
          "nsec signer requires syndication.nostr.signer.encryptedNsec"
        );
      }
      if (!config.jwtSecret) {
        throw new Error(
          "nsec signer requires jwtSecret to be set (HYPERNEXT_JWT_SECRET env var)"
        );
      }
    } else if (
      nostr.signer.type === "nip46" &&
      !BUNKER_URI_RE.test(nostr.signer.bunkerUri)
    ) {
      throw new Error(
        "nip46 signer requires a valid nostrconnect:// or bunker:// URI"
      );
    }
    if (nostr.defaultHashtags) {
      for (const tag of nostr.defaultHashtags) {
        if (!HASHTAG_RE.test(tag)) {
          throw new Error(
            `Invalid default hashtag "${tag}": must be alphanumeric (no spaces)`
          );
        }
      }
    }
  }

  // Waline comments validation
  const waline = config.comments?.waline;
  if (waline?.enabled) {
    if (waline.mode === "external") {
      if (!waline.serverURL) {
        throw new Error(
          "waline.mode: 'external' requires comments.waline.serverURL"
        );
      }
      if (!waline.serverURL.startsWith("https://")) {
        throw new Error("waline.serverURL must use HTTPS protocol");
      }
    }
    if (waline.mode === "embedded") {
      if (!waline.storage) {
        throw new Error(
          "waline.enabled: true with mode 'embedded' requires comments.waline.storage"
        );
      }
      if (waline.storage.type === "sqlite") {
        if (!waline.storage.path) {
          throw new Error(
            "waline.storage.type: 'sqlite' requires comments.waline.storage.path"
          );
        }
        if (path.isAbsolute(waline.storage.path)) {
          throw new Error(
            "waline.storage.path must be a relative path, not absolute"
          );
        }
        if (waline.storage.path.includes("..")) {
          throw new Error(
            "waline.storage.path must not contain '..' path traversal"
          );
        }
      }
    }
    if (
      waline.auth.login === "force" &&
      waline.auth.registration === "closed"
    ) {
      throw new Error(
        "waline.auth.login: 'force' requires waline.auth.registration to be 'open' or 'admin-only', not 'closed'"
      );
    }
    if (waline.notifications?.email) {
      const email = waline.notifications.email;
      if (!(email.host && email.user && email.password && email.senderEmail)) {
        throw new Error(
          "waline.notifications.email requires all fields: host, user, password, senderEmail"
        );
      }
    }
    if (
      waline.oauth?.github &&
      !(waline.oauth.github.clientId && waline.oauth.github.clientSecret)
    ) {
      throw new Error("waline.oauth.github requires clientId and clientSecret");
    }
    if (waline.antiSpam?.secureDomains?.length) {
      const siteOrigin = new URL(
        config.site?.canonicalBase || "http://localhost"
      ).origin;
      if (!waline.antiSpam.secureDomains.includes(siteOrigin)) {
        console.warn(
          `Warning: waline.antiSpam.secureDomains should include ${siteOrigin} (site origin)`
        );
      }
    }
  }
}

/**
 * Resolve all relative filesystem paths in config against a project root.
 * This ensures paths like "./db/hypernext.db" work regardless of process.cwd().
 */
export function resolveConfigPaths(
  config: HypernextConfig,
  projectRoot: string
): void {
  const resolve = (p: string): string => {
    // Absolute paths and URLs are left as-is
    if (
      path.isAbsolute(p) ||
      p.startsWith("http://") ||
      p.startsWith("https://") ||
      p.startsWith("data:")
    ) {
      return p;
    }
    return path.resolve(projectRoot, p);
  };

  // Database
  if (config.database?.path && config.database.path !== ":memory:") {
    config.database.path = resolve(config.database.path);
  }

  // Storage (local only)
  if (config.storage?.type === "local" && config.storage.local?.path) {
    config.storage.local.path = resolve(config.storage.local.path);
  }

  // Resolve all optional path fields via data-driven loop
  // biome-ignore lint/suspicious/noExplicitAny: config types vary, need generic access
  const pathFields: Array<{ obj: any; key: string }> = [
    { obj: config.site?.theme, key: "cssPath" },
    { obj: config.site?.pdf, key: "cssPath" },
    { obj: config.site?.ebooks, key: "coverImage" },
    { obj: config.protocols?.gemini, key: "certPath" },
    { obj: config.protocols?.gemini, key: "keyPath" },
    { obj: config.protocols?.spartan, key: "certPath" },
    { obj: config.protocols?.spartan, key: "keyPath" },
    { obj: config.logging, key: "filePath" },
    { obj: config.author, key: "photo" },
    { obj: config.site?.organization, key: "logo" },
    { obj: config.comments?.waline?.storage, key: "path" },
  ];
  for (const { obj, key } of pathFields) {
    if (obj && typeof obj[key] === "string") {
      obj[key] = resolve(obj[key] as string);
    }
  }
}

export function loadConfig(configPath: string): HypernextConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  const substituted = substituteEnvInYaml(raw);
  const parsed = yaml.parse(substituted) as HypernextConfig;
  // Validation happens after mergeCliOverrides so CLI flags can fill gaps
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

  const protoVal = (
    proto: keyof HypernextConfig["protocols"]
  ): boolean | undefined => {
    switch (proto) {
      case "http":
        return options.http;
      case "gemini":
        return options.gemini;
      case "gopher":
        return options.gopher;
      case "spartan":
        return options.spartan;
      case "nex":
        return options.nex;
      case "finger":
        return options.finger;
      case "text":
        return options.text;
      default:
        return;
    }
  };
  const protocolKeys = [
    "http",
    "gemini",
    "gopher",
    "spartan",
    "nex",
    "finger",
    "text",
  ] as const;
  for (const proto of protocolKeys) {
    const val = protoVal(proto);
    if (val !== undefined) {
      overrides.protocols = {
        ...(overrides.protocols ?? config.protocols),
        [proto]: { ...config.protocols[proto], enabled: val },
      };
    }
  }

  if (options.mcp !== undefined) {
    overrides.agent = {
      ...config.agent,
      enabled: options.mcp,
    } as import("./types/config.js").AgentConfig;
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
  resolveConfigPaths(config, cwd);
  const merged = mergeCliOverrides(config, options);
  validateConfig(merged);
  return merged;
}
