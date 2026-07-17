import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Hypernext",
  description:
    "Multi-Protocol MDX Document Server and IndieWeb Publishing Engine",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Protocols", link: "/protocols" },
      { text: "IndieWeb", link: "/indieweb" },
      { text: "API", link: "/api" },
      { text: "Customization", link: "/customization" },
    ],
    sidebar: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Protocols", link: "/protocols" },
      { text: "IndieWeb Features", link: "/indieweb" },
      { text: "API Reference", link: "/api" },
      { text: "Customization", link: "/customization" },
    ],
  },
});
