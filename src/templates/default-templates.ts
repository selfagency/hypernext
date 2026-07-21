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
];
