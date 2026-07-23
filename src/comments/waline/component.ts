import type { IrNode } from "../../parser/ir.js";
import type { ComponentContext } from "../../parser/resolver.js";

/**
 * Built-in MDX component: WalineComments
 *
 * Renders the Waline comment widget on posts that have waline: true in frontmatter.
 *
 * Usage in MDX:
 * ```mdx
 * <WalineComments path="/blog/my-post" />
 * ```
 */
export function resolveWalineComments(
  context: ComponentContext,
  _node: IrNode
): IrNode[] {
  const { config, currentSlug } = context;
  const waline = config.comments?.waline;

  // If Waline is not enabled, render a placeholder
  if (!waline?.enabled) {
    return [
      {
        type: "html" as const,
        value: "<!-- Waline comments not enabled -->",
      },
    ];
  }

  // Get the path from attributes or use the current page's path
  const path = currentSlug || "/";

  // Get server URL for the comments API
  const serverUrl =
    waline.mode === "external"
      ? waline.serverURL
      : `http://127.0.0.1:${waline.port || 8360}`;

  // Generate the client-side initialization script
  // Waline requires client-side initialization with the path
  const html = `
<div id="waline-comments" class="waline-comments-container"></div>
<script>
(function() {
  if (typeof Waline === 'undefined') {
    // Load Waline client from CDN
    var script = document.createElement('script');
    script.src = 'https://unpkg.com/@waline/client@3/dist/waline.js';
    script.onload = initWaline;
    document.head.appendChild(script);
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/@waline/client@3/dist/waline.css';
    document.head.appendChild(link);
  } else {
    initWaline();
  }

  function initWaline() {
    Waline.init({
      el: '#waline-comments',
      serverURL: '${serverUrl}',
      path: '${path}',
      lang: '${config.site?.meta?.lang || "en"}',
      meta: ${JSON.stringify(waline.auth?.anonymous ? [] : ["nick", "mail"])},
      requiredMeta: ${JSON.stringify(waline.auth?.anonymous ? [] : ["nick"])},
      wordLimit: ${waline.markdown?.emoji ? 0 : 500},
      uploadImage: false,
      highlight: ${waline.markdown?.highlight ?? true},
      tex: ${JSON.stringify(waline.markdown?.tex)},
      emoji: ${JSON.stringify(
        waline.markdown?.emoji
          ? [
              "//unpkg.com/@waline/emojis@1.1.0/bilibili",
              "//unpkg.com/@waline/emojis@1.1.0/tieba",
              "//unpkg.com/@waline/emojis@1.1.0/twemoji",
            ]
          : []
      )},
      anonymous: ${waline.auth?.anonymous ?? true},
      login: '${waline.auth?.login || "disable"}',
      pageview: ${waline.pageview?.enabled ?? false},
    });
  }
})();
</script>
`;

  return [
    {
      type: "html" as const,
      value: html,
    },
  ];
}
