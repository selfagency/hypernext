export interface DefaultTemplate {
  content: string;
  filename: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    filename: "default.mdx",
    content: `---
---

<slot />
`,
  },
  {
    filename: "blog.mdx",
    content: `---
---

<slot />

<Sidebar />
`,
  },
  {
    filename: "email.mdx",
    content: `---
title: Newsletter
---

<slot />

---

<Footer />
`,
  },
  {
    filename: "email-digest.mdx",
    content: `---
subject: "Weekly Digest"
---

<div style="font-family: sans-serif; max-width: 600px; margin: auto;">
  <h1 style="color: #333;">Weekly Digest</h1>
  {#each docs as doc}
  <div style="margin: 16px 0; padding: 12px; border: 1px solid #eee; border-radius: 4px;">
    <h2 style="margin: 0 0 8px;"><a href="{doc.url}" style="color: #0066cc;">{doc.title}</a></h2>
    <p style="color: #555; margin: 0;">{doc.description}</p>
  </div>
  {/each}
  <hr style="margin: 20px 0;" />
  <p style="font-size: 12px; color: #999;">
    <a href="{unsubscribeUrl}">Unsubscribe</a>
  </p>
</div>
`,
  },
];
