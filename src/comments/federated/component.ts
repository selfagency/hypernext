/**
 * Federated Comments component for MDX.
 * Displays comments fetched from syndicated platforms (Bluesky, Nostr, Mastodon).
 */

import type { IrNode } from "../../parser/ir.js";
import type { ComponentContext } from "../../parser/resolver.js";

/**
 * Resolve FederatedComments component in MDX.
 *
 * Usage in MDX:
 * ```mdx
 * <FederatedComments />
 * ```
 *
 * Renders comments from all syndicated platforms (Bluesky, Nostr, Mastodon).
 */
export function resolveFederatedComments(
  context: ComponentContext,
  _node: IrNode
): IrNode[] {
  const { config, currentSlug } = context;
  const slug = currentSlug || "/";

  // Check if any syndication is enabled
  const syndication = config.syndication;
  const hasBluesky = syndication?.bluesky?.enabled;
  const hasNostr = syndication?.nostr?.enabled;
  const hasMastodon = syndication?.mastodon?.enabled;

  // If no syndication is enabled, render nothing
  if (!(hasBluesky || hasNostr || hasMastodon)) {
    return [
      {
        type: "html" as const,
        value: "<!-- Federated comments: no syndication configured -->",
      },
    ];
  }

  // Generate HTML that fetches and renders comments client-side
  const html = `
<div id="federated-comments" class="federated-comments">
  <div class="federated-comments-header">
    <h3>Comments</h3>
    <span class="federated-comments-count" id="federated-comments-count">Loading...</span>
  </div>
  <div class="federated-comments-list" id="federated-comments-list">
    <div class="federated-comments-loading">Loading comments...</div>
  </div>
  <div class="federated-comments-footer">
    <a href="#" class="federated-comments-subscribe">Subscribe to comments</a>
  </div>
</div>

<style>
.federated-comments {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}
.federated-comments-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.federated-comments-header h3 {
  margin: 0;
  font-size: 1.25rem;
}
.federated-comments-count {
  color: #6b7280;
  font-size: 0.875rem;
}
.federated-comments-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.federated-comment {
  padding: 1rem;
  background: #f9fafb;
  border-radius: 0.5rem;
}
.federated-comment-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.federated-comment-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.federated-comment-author {
  font-weight: 500;
}
.federated-comment-handle {
  color: #6b7280;
  font-size: 0.875rem;
}
.federated-comment-time {
  color: #9ca3af;
  font-size: 0.75rem;
  margin-left: auto;
}
.federated-comment-content {
  line-height: 1.5;
}
.federated-comment-platform {
  display: inline-block;
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  text-transform: uppercase;
  border-radius: 0.25rem;
  margin-left: 0.5rem;
}
.federated-comment-platform.bluesky { background: #0085ff; color: white; }
.federated-comment-platform.nostr { background: #决定7f00; color: white; }
.federated-comment-platform.mastodon { background: #6364ff; color: white; }
.federated-comments-loading, .federated-comments-empty {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}
.federated-comments-footer {
  margin-top: 1rem;
  text-align: center;
}
.federated-comments-subscribe {
  color: #6b7280;
  font-size: 0.875rem;
}
</style>

<script>
(function() {
  const SLUG = '${slug}';
  const API_BASE = '';

  async function loadComments() {
    try {
      const response = await fetch(API_BASE + '/api/comments/federated/' + encodeURIComponent(SLUG));
      if (!response.ok) {
        throw new Error('Failed to fetch comments');
      }
      const comments = await response.json();
      renderComments(comments);
    } catch (err) {
      console.error('Failed to load federated comments:', err);
      document.getElementById('federated-comments-list').innerHTML = 
        '<div class="federated-comments-empty">Comments unavailable</div>';
    }
  }

  function renderComments(comments) {
    const list = document.getElementById('federated-comments-list');
    const count = document.getElementById('federated-comments-count');
    
    if (!comments || comments.length === 0) {
      list.innerHTML = '<div class="federated-comments-empty">No comments yet</div>';
      count.textContent = '(0)';
      return;
    }

    // Skip the first comment if it's the original post (for Bluesky)
    const displayComments = comments.length > 0 && comments[0].isRootPost 
      ? comments.slice(1) 
      : comments;

    count.textContent = '(' + displayComments.length + ')';

    list.innerHTML = displayComments.map(function(comment) {
      const date = new Date(comment.createdAt).toLocaleDateString();
      const avatar = comment.author.avatar || '';
      const platformClass = comment.platform;
      
      return '<article class="federated-comment">' +
        '<div class="federated-comment-header">' +
          (avatar ? '<img class="federated-comment-avatar" src="' + avatar + '" alt="">' : '') +
          '<span class="federated-comment-author">' + escapeHtml(comment.author.name) + '</span>' +
          '<span class="federated-comment-handle">@' + escapeHtml(comment.author.handle) + '</span>' +
          '<span class="federated-comment-time">' + date + '</span>' +
          '<span class="federated-comment-platform ' + platformClass + '">' + comment.platform + '</span>' +
        '</div>' +
        '<div class="federated-comment-content">' + escapeHtml(comment.content) + '</div>' +
      '</article>';
    }).join('');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Load comments when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadComments);
  } else {
    loadComments();
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
