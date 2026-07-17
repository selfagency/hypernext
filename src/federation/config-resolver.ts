import { getEm } from "../database/index.js";
import type { CommentConfig, HypernextConfig } from "../types/config.js";

const DEFAULT_COMMENT_CONFIG: CommentConfig = {
  enabled: true,
  inbound: {
    webmention: true,
    pingback: true,
    trackback: false,
  },
  aggregation: {
    mastodon: true,
    bluesky: true,
    cacheTtl: 900,
  },
  akismet: {
    enabled: true,
  },
  allowPrivateSources: false,
};

export function getGlobalCommentConfig(config: HypernextConfig): CommentConfig {
  return {
    ...DEFAULT_COMMENT_CONFIG,
    ...config.comments,
    inbound: {
      ...DEFAULT_COMMENT_CONFIG.inbound,
      ...config.comments?.inbound,
    },
    aggregation: {
      ...DEFAULT_COMMENT_CONFIG.aggregation,
      ...config.comments?.aggregation,
    },
    akismet: {
      ...DEFAULT_COMMENT_CONFIG.akismet,
      ...config.comments?.akismet,
    },
  };
}

export async function resolveCommentConfig(
  config: HypernextConfig,
  slug: string
): Promise<CommentConfig> {
  const globalConfig = getGlobalCommentConfig(config);

  const em = getEm();
  const doc = await em.findOne("DocMeta", { slug }, { fields: ["metaJson"] });
  if (!doc) {
    throw new Error(`Document not found: ${slug}`);
  }

  const frontmatter = doc.metaJson
    ? (JSON.parse(doc.metaJson as string) as Record<string, unknown>)
    : {};

  const docComments = frontmatter.comments as
    | Record<string, unknown>
    | undefined;

  const finalConfig: CommentConfig = {
    enabled: globalConfig.enabled,
    inbound: {
      webmention:
        ((docComments?.inbound as Record<string, unknown>)
          ?.webmention as boolean) ?? globalConfig.inbound.webmention,
      pingback:
        ((docComments?.inbound as Record<string, unknown>)
          ?.pingback as boolean) ?? globalConfig.inbound.pingback,
      trackback:
        ((docComments?.inbound as Record<string, unknown>)
          ?.trackback as boolean) ?? globalConfig.inbound.trackback,
    },
    aggregation: {
      mastodon:
        ((docComments?.aggregation as Record<string, unknown>)
          ?.mastodon as boolean) ?? globalConfig.aggregation.mastodon,
      bluesky:
        ((docComments?.aggregation as Record<string, unknown>)
          ?.bluesky as boolean) ?? globalConfig.aggregation.bluesky,
      cacheTtl:
        ((docComments?.aggregation as Record<string, unknown>)
          ?.cacheTtl as number) ?? globalConfig.aggregation.cacheTtl,
    },
    akismet: {
      enabled: globalConfig.akismet.enabled,
      apiKey: globalConfig.akismet.apiKey,
      endpoint: globalConfig.akismet.endpoint,
    },
    allowPrivateSources: globalConfig.allowPrivateSources,
  };

  if (!globalConfig.enabled) {
    finalConfig.inbound.webmention = false;
    finalConfig.inbound.pingback = false;
    finalConfig.inbound.trackback = false;
    finalConfig.aggregation.mastodon = false;
    finalConfig.aggregation.bluesky = false;
  }

  return finalConfig;
}
