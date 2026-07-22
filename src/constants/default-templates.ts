export interface DefaultTemplate {
  content: string;
  filename: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    filename: "default.mdx",
    content: `---
---

<header className="site-header">
  <NavMenu />
  <Search />
</header>
<main className="main-content">
  <slot />
</main>
<footer className="site-footer">
  <Footer />
</footer>
`,
  },
  {
    filename: "blog.mdx",
    content: `---
---

<header className="site-header">
  <NavMenu />
  <Search />
</header>
<main className="main-content">
  <slot />
  <Sidebar />
</main>
<footer className="site-footer">
  <Footer />
</footer>
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
  <RecentPosts limit={10} />
  <hr style="margin: 20px 0;" />
  <p style="font-size: 12px; color: #999;">
    <a href="/subscribe/unsubscribe">Unsubscribe</a>
  </p>
</div>
`,
  },
];
