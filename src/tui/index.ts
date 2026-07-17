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

  function closePalette() {
    state.commandPalette.open = false;
    state.commandPalette.filter = "";
    state.commandPalette.selectedIndex = 0;
    renderApp();
  }

  function saveCurrentFile() {
    const file = currentFiles[state.activeFileIndex];
    if (!file) {
      return;
    }
    const mdx = serializeFrontmatter(file.frontmatter, file.content);
    file.isModified = false;
    if (mode === "local") {
      const fs = require("node:fs");
      const path = require("node:path");
      const contentDir = path.resolve(
        config.storage.local?.path ?? "./content"
      );
      const filePath = path.join(contentDir, `${file.slug}.mdx`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, mdx, "utf-8");
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
    if (str === "\u0013") {
      app.saveCurrentFile();
    }
    if (str === "\u0002") {
      app.state.explorerVisible = !app.state.explorerVisible;
      app.render();
    }
    if (str === "\u0010") {
      app.state.previewVisible = !app.state.previewVisible;
      app.render();
    }
    if (str === "\u000b") {
      app.onOpenPalette();
    }
    if (str === "\u0011") {
      process.exit(0);
    }
  });
}

export { createEditorApp };
