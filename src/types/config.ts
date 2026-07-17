export interface SiteMetaConfig {
  description: string;
  lang: string;
  ogDescription?: string;
  ogImage?: string;
  ogImageAlt?: string;
  ogTitle?: string;
  title: string;
}

export interface SiteThemeConfig {
  cssPath?: string;
}

export interface SitePdfConfig {
  cssPath?: string;
  enabled: boolean;
}

export interface SiteEbooksConfig {
  coverImage?: string;
  enabled: boolean;
}

export interface SiteConfig {
  canonicalBase: string;
  ebookCoverImage?: string;
  ebooks: SiteEbooksConfig;
  meta: SiteMetaConfig;
  organization?: OrganizationConfig;
  pdf: SitePdfConfig;
  pdfCssPath?: string;
  theme?: SiteThemeConfig;
}

export interface AuthorConfig {
  bio?: string;
  email?: string;
  name: string;
  photo?: string;
  socials?: Record<string, string>;
  url?: string;
}

export interface OrganizationContactPoint {
  email?: string;
  url?: string;
}

export interface OrganizationAddress {
  country?: string;
  locality?: string;
}

export interface OrganizationConfig {
  address?: OrganizationAddress;
  contactPoint?: OrganizationContactPoint;
  founders?: string[];
  logo?: string;
  name: string;
  sameAs?: string[];
  url?: string;
}

export interface StorageLocalConfig {
  path: string;
}

export interface StorageS3Config {
  accessKeyId: string;
  bucket: string;
  endpoint?: string;
  region: string;
  secretAccessKey: string;
}

export interface StorageConfig {
  local?: StorageLocalConfig;
  s3?: StorageS3Config;
  type: "local" | "s3";
}

export interface DatabaseConfig {
  path: string;
  type: "sqlite";
}

export interface CommentInboundConfig {
  pingback: boolean;
  trackback: boolean;
  webmention: boolean;
}

export interface CommentAggregationConfig {
  bluesky: boolean;
  cacheTtl: number;
  mastodon: boolean;
}

export interface CommentBlocklistConfig {
  domains: string[];
  handles: string[];
  ips: string[];
}

export interface CommentAkismetConfig {
  apiKey?: string;
  enabled: boolean;
  endpoint?: string;
}

export interface CommentConfig {
  aggregation: CommentAggregationConfig;
  akismet: CommentAkismetConfig;
  allowPrivateSources?: boolean;
  blocklist?: CommentBlocklistConfig;
  enabled: boolean;
  inbound: CommentInboundConfig;
}

export interface ApiConfig {
  enabled: boolean;
}

export interface CollectionConfig {
  compileToEbook?: boolean;
  layout?: string;
  path: string;
  rss: boolean;
  syndicate: boolean;
}

export interface TaxonomyConfig {
  name: string;
  plural: string;
  singular: string;
}

export interface ProtocolServerConfig {
  certPath?: string;
  enabled: boolean;
  keyPath?: string;
  port: number;
}

export interface ProtocolsConfig {
  finger: ProtocolServerConfig;
  gemini: ProtocolServerConfig;
  gopher: ProtocolServerConfig;
  http: ProtocolServerConfig;
  nex: ProtocolServerConfig;
  spartan: ProtocolServerConfig;
  text: ProtocolServerConfig;
}

export interface MicropubConfig {
  enabled: boolean;
}

export interface MastodonSyndicationConfig {
  accessToken?: string;
  enabled: boolean;
  instance: string;
}

export interface BlueskySyndicationConfig {
  accessToken?: string;
  enabled: boolean;
  identifier?: string;
  service: string;
  standardSite?: boolean;
}

export interface SyndicationConfig {
  bluesky?: BlueskySyndicationConfig;
  mastodon?: MastodonSyndicationConfig;
}

export interface McpConfig {
  enabled: boolean;
  transport: "stdio" | "sse";
}

export interface RemoteConfig {
  enabled: boolean;
  token: string;
  url: string;
}

export interface HypernextConfig {
  api: ApiConfig;
  author: AuthorConfig;
  collections: Record<string, CollectionConfig>;
  comments?: CommentConfig;
  database: DatabaseConfig;
  mcp: McpConfig;
  micropub: MicropubConfig;
  protocols: ProtocolsConfig;
  site: SiteConfig;
  storage: StorageConfig;
  syndication: SyndicationConfig;
  taxonomies: TaxonomyConfig[];
}

export interface CliOptions {
  config?: string;
  gemini?: boolean;
  gopher?: boolean;
  port?: number;
}
