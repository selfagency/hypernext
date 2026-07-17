import { render } from "ink";
import React from "react";
import type { HypernextConfig } from "../types/config.js";
import { EditorLayout } from "./components.js";
import type { CommandItem, EditorFile, EditorState } from "./state.js";
import {
  createInitialState,
  parseFrontmatter,
  serializeFrontmatter,
} from "./state.js";

const MDX_EXT_REGEX = /\.mdx$/;
const BACKSLASH_REGEX = /\\/g;

function createEditorApp(config: HypernextConfig, mode: "local" | "remote") {
  const state: EditorState = createInitialState(mode);
  const currentFiles: EditorFile[] = [];
  let currentRerender: (() => void) | null = null;

  function buildCommandItems(): CommandItem[] {
    return [
      {
        id: "toggle-explorer",
        label: "Toggle Explorer",
        key: "Ctrl+B",
        action() {
          state.explorerVisible = !state.explorerVisible;
          closePalette();
        },
      },
      {
        id: "toggle-preview",
        label: "Toggle Preview",
        key: "Ctrl+P",
        action() {
          state.previewVisible = !state.previewVisible;
          closePalette();
        },
      },
      {
        id: "toggle-diagnostics",
        label: "Toggle Diagnostics",
        key: "Tab",
        action() {
          state.previewMode =
            state.previewMode === "preview" ? "diagnostics" : "preview";
          closePalette();
        },
      },
      {
        id: "save-file",
        label: "Save File",
        key: "Ctrl+S",
        action() {
          saveCurrentFile();
          closePalette();
        },
      },
      {
        id: "new-post",
        label: "New Post",
        key: "Ctrl+N",
        action() {
          const slug = `blog/${new Date().toISOString().slice(0, 10)}-untitled`;
          const frontmatter = {
            title: "Untitled",
            date: new Date().toISOString(),
            type: "post",
          };
          currentFiles.push({
            slug,
            title: "Untitled",
            content: "Write your content here...",
            frontmatter,
            isModified: true,
          });
          state.activeFileIndex = currentFiles.length - 1;
          closePalette();
        },
      },
      {
        id: "dashboard",
        label: "Open Dashboard",
        key: "Ctrl+D",
        action() {
          state.dashboardVisible = !state.dashboardVisible;
          state.moderationVisible = false;
          state.taxonomyVisible = false;
          state.logsVisible = false;
          if (state.dashboardVisible) {
            fetchDashboardData();
          }
          closePalette();
        },
      },
      {
        id: "moderation",
        label: "Open Moderation Queue",
        key: "Ctrl+M",
        action() {
          state.moderationVisible = !state.moderationVisible;
          state.dashboardVisible = false;
          state.taxonomyVisible = false;
          state.logsVisible = false;
          if (state.moderationVisible) {
            fetchModerationItems();
          }
          closePalette();
        },
      },
      {
        id: "taxonomy",
        label: "Open Taxonomy Manager",
        key: "Ctrl+T",
        action() {
          state.taxonomyVisible = !state.taxonomyVisible;
          state.dashboardVisible = false;
          state.moderationVisible = false;
          state.logsVisible = false;
          closePalette();
        },
      },
      {
        id: "logs",
        label: "Open System Logs",
        key: "Ctrl+L",
        action() {
          state.logsVisible = !state.logsVisible;
          state.dashboardVisible = false;
          state.moderationVisible = false;
          state.taxonomyVisible = false;
          closePalette();
        },
      },
      {
        id: "push",
        label: "Push to Production",
        key: "",
        action() {
          if (mode === "local") {
            pushToRemote();
          }
          closePalette();
        },
      },
      {
        id: "sync",
        label: "Sync with Production",
        key: "",
        action() {
          if (mode === "local") {
            syncWithRemote();
          }
          closePalette();
        },
      },
      {
        id: "quit",
        label: "Quit",
        key: "Ctrl+Q",
        action() {
          process.exit(0);
        },
      },
    ];
  }

  async function fetchDashboardData() {
    try {
      if (mode === "remote" && config.remote?.url) {
        const res = await fetch(`${config.remote.url}/api/v1/stats/overview`, {
          headers: { Authorization: `Bearer ${config.remote.token}` },
        });
        const stats = await res.json();
        state.dashboardData = {
          analytics: `Total Views: ${stats.totalViews ?? "N/A"} | Unique Visitors: ${stats.uniqueVisitors ?? "N/A"}`,
          moderationPending: 0,
          moderationSpam: 0,
          totalPosts: 0,
          totalDocs: 0,
        };
      } else {
        const { getEm } = await import("../database/index.js");
        const em = getEm();
        const docs = await em.find("DocMeta", {}, { fields: ["slug", "type"] });
        const posts = docs.filter(
          (d: Record<string, unknown>) => d.type === "post"
        );
        state.dashboardData = {
          analytics: "(local mode — no analytics)",
          moderationPending: 0,
          moderationSpam: 0,
          totalPosts: posts.length,
          totalDocs: docs.length,
        };
      }
    } catch {
      state.dashboardData = {
        analytics: "Error fetching data",
        moderationPending: 0,
        moderationSpam: 0,
        totalPosts: 0,
        totalDocs: 0,
      };
    }
    renderApp();
  }

  async function fetchModerationItems() {
    try {
      if (mode === "remote" && config.remote?.url) {
        const res = await fetch(
          `${config.remote.url}/api/v1/comments?status=pending`,
          {
            headers: { Authorization: `Bearer ${config.remote.token}` },
          }
        );
        const data = await res.json();
        state.moderationItems = (data.data ?? []).map(
          (m: Record<string, unknown>) => ({
            id: String(m.id),
            authorName: String(m.authorName ?? m.author_name ?? "Anonymous"),
            platform: String(m.platform ?? "webmention"),
            content: String(m.content ?? ""),
            spamStatus: String(m.spamStatus ?? m.spam_status ?? "pending"),
          })
        );
      } else {
        const { getEm } = await import("../database/index.js");
        const { Mention } = await import("../database/entities/mention.js");
        const em = getEm();
        const mentions = await em.find(
          Mention,
          { spamStatus: "pending" },
          { limit: 50, orderBy: { publishedAt: "DESC" } }
        );
        state.moderationItems = mentions.map((m: Record<string, unknown>) => ({
          id: String(m.id),
          authorName: String(m.authorName ?? "Anonymous"),
          platform: String(m.platform ?? "webmention"),
          content: String(m.content ?? ""),
          spamStatus: String(m.spamStatus ?? "pending"),
        }));
      }
    } catch {
      state.moderationItems = [];
    }
    renderApp();
  }

  async function moderateItem(id: string, status: string) {
    try {
      if (mode === "remote" && config.remote?.url) {
        await fetch(`${config.remote.url}/api/v1/comments/${id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${config.remote.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        });
      } else {
        const { getEm } = await import("../database/index.js");
        const { Mention } = await import("../database/entities/mention.js");
        const em = getEm();
        const mention = await em.findOne(Mention, { id });
        if (mention) {
          mention.spamStatus = status;
          await em.flush();
        }
      }
      state.moderationItems = state.moderationItems.filter((m) => m.id !== id);
      renderApp();
    } catch {
      // Silently fail
    }
  }

  async function pushToRemote() {
    const { pushToRemote: push } = await import("../sync/sync-manager.js");
    await push(config, (msg) => console.log(msg));
  }

  async function syncWithRemote() {
    const { syncTwoWay: sync } = await import("../sync/sync-manager.js");
    await sync(config, (msg) => console.log(msg));
  }

  function closePalette() {
    state.commandPalette.open = false;
    state.commandPalette.filter = "";
    state.commandPalette.selectedIndex = 0;
    renderApp();
  }

  async function saveCurrentFile() {
    const file = currentFiles[state.activeFileIndex];
    if (!file) {
      return;
    }
    const mdx = serializeFrontmatter(file.frontmatter, file.content);
    file.isModified = false;
    if (mode === "local") {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const contentDir = path.resolve(
        config.storage.local?.path ?? "./content"
      );
      const filePath = path.join(contentDir, `${file.slug}.mdx`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, mdx, "utf-8");
    } else if (mode === "remote" && config.remote?.url) {
      try {
        await fetch(`${config.remote.url}/api/v1/docs/${file.slug}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${config.remote.token}`,
            "Content-Type": "text/plain",
          },
          body: mdx,
        });
      } catch (err) {
        console.error("Remote save failed:", err);
      }
    }
    renderApp();
  }

  function onFileSelect(index: number) {
    state.activeFileIndex = index;
    renderApp();
  }

  function onFrontmatterUpdate(key: string, value: unknown) {
    const file = currentFiles[state.activeFileIndex];
    if (!file) {
      return;
    }
    file.frontmatter[key] = value;
    file.isModified = true;
    renderApp();
  }

  function onBodyChange(value: string) {
    const file = currentFiles[state.activeFileIndex];
    if (!file) {
      return;
    }
    file.content = value;
    file.isModified = true;
    renderApp();
  }

  function onToggleExplorer() {
    state.explorerVisible = !state.explorerVisible;
    renderApp();
  }

  function onTogglePreview() {
    state.previewVisible = !state.previewVisible;
    renderApp();
  }

  function onTogglePreviewMode() {
    state.previewMode =
      state.previewMode === "preview" ? "diagnostics" : "preview";
    renderApp();
  }

  function onOpenPalette() {
    state.commandPalette.open = true;
    state.commandPalette.items = buildCommandItems();
    state.commandPalette.filter = "";
    state.commandPalette.selectedIndex = 0;
    renderApp();
  }

  function onPaletteFilterChange(value: string) {
    state.commandPalette.filter = value;
    state.commandPalette.selectedIndex = 0;
    renderApp();
  }

  function onPaletteSelect(item: CommandItem) {
    item.action();
  }

  function openFile(slug: string, rawMdx: string) {
    const { frontmatter, body } = parseFrontmatter(rawMdx);
    const existing = currentFiles.findIndex((f) => f.slug === slug);
    if (existing >= 0) {
      state.activeFileIndex = existing;
    } else {
      currentFiles.push({
        slug,
        title: (frontmatter.title as string) ?? slug,
        content: body,
        frontmatter,
        isModified: false,
      });
      state.activeFileIndex = currentFiles.length - 1;
    }
    renderApp();
  }

  function renderApp() {
    const app = React.createElement(EditorLayout, {
      state,
      files: currentFiles,
      onFileSelect,
      onFrontmatterUpdate,
      onBodyChange,
      onToggleExplorer,
      onTogglePreview,
      onTogglePreviewMode,
      onOpenPalette,
      onPaletteFilterChange,
      onPaletteSelect,
      onModerate: moderateItem,
    });
    if (currentRerender) {
      currentRerender();
    } else {
      const { rerender } = render(app);
      currentRerender = rerender;
    }
  }

  return {
    render: renderApp,
    openFile,
    state,
    saveCurrentFile,
    onOpenPalette,
    getFiles: () => currentFiles,
  };
}

export function startEditor(
  config: HypernextConfig,
  mode: "local" | "remote"
): void {
  const app = createEditorApp(config, mode);

  if (mode === "local") {
    const fs = require("node:fs");
    const path = require("node:path");
    const contentDir = path.resolve(config.storage.local?.path ?? "./content");
    if (fs.existsSync(contentDir)) {
      const files = fs.readdirSync(contentDir, { recursive: true }) as string[];
      const mdxFiles = files.filter(
        (f: string) => f.endsWith(".mdx") && !f.startsWith(".")
      );
      for (const file of mdxFiles.slice(0, 5)) {
        const slug = file
          .replace(MDX_EXT_REGEX, "")
          .replace(BACKSLASH_REGEX, "/");
        const filePath = path.join(contentDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        app.openFile(slug, content);
      }
    }
  }

  app.render();

  process.stdin.on("data", (key) => {
    const str = key.toString();
    // Ctrl+S
    if (str === "\u0013") {
      app.saveCurrentFile();
    }
    // Ctrl+B
    if (str === "\u0002") {
      app.state.explorerVisible = !app.state.explorerVisible;
      app.render();
    }
    // Ctrl+P
    if (str === "\u0010") {
      app.state.previewVisible = !app.state.previewVisible;
      app.render();
    }
    // Ctrl+K
    if (str === "\u000b") {
      app.onOpenPalette();
    }
    // Ctrl+Q
    if (str === "\u0011") {
      process.exit(0);
    }
    // Ctrl+D — dashboard
    if (str === "\u0004") {
      app.state.dashboardVisible = !app.state.dashboardVisible;
      app.state.moderationVisible = false;
      app.state.taxonomyVisible = false;
      app.state.logsVisible = false;
      app.render();
    }
    // Ctrl+T — taxonomy
    if (str === "\u0014") {
      app.state.taxonomyVisible = !app.state.taxonomyVisible;
      app.state.dashboardVisible = false;
      app.state.moderationVisible = false;
      app.state.logsVisible = false;
      app.render();
    }
    // Ctrl+L — logs
    if (str === "\u000c") {
      app.state.logsVisible = !app.state.logsVisible;
      app.state.dashboardVisible = false;
      app.state.moderationVisible = false;
      app.state.taxonomyVisible = false;
      app.render();
    }
  });
}

export { createEditorApp };
