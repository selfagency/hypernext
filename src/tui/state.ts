export interface EditorFile {
  content: string;
  frontmatter: Record<string, unknown>;
  isModified: boolean;
  slug: string;
  title: string;
}

export interface CommandItem {
  action: () => void;
  id: string;
  key: string;
  label: string;
}

export interface CommandPaletteState {
  filter: string;
  items: CommandItem[];
  open: boolean;
  selectedIndex: number;
}

export interface DashboardData {
  analytics: string;
  moderationPending: number;
  moderationSpam: number;
  totalDocs: number;
  totalPosts: number;
}

export interface ModerationItem {
  authorName: string;
  content: string;
  id: string;
  platform: string;
  spamStatus: string;
}

export interface EditorState {
  activeFileIndex: number;
  commandPalette: CommandPaletteState;
  dashboardData: DashboardData | null;
  dashboardVisible: boolean;
  explorerVisible: boolean;
  files: EditorFile[];
  logsVisible: boolean;
  mode: "local" | "remote";
  moderationItems: ModerationItem[];
  moderationVisible: boolean;
  previewMode: "preview" | "diagnostics";
  previewVisible: boolean;
  subscribersVisible: boolean;
  taxonomyVisible: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const NUMERIC_REGEX = /^\d+$/;

export function createInitialState(mode: "local" | "remote"): EditorState {
  return {
    files: [],
    activeFileIndex: -1,
    explorerVisible: true,
    previewVisible: true,
    previewMode: "preview",
    dashboardVisible: false,
    dashboardData: null,
    moderationVisible: false,
    moderationItems: [],
    taxonomyVisible: false,
    logsVisible: false,
    subscribersVisible: false,
    commandPalette: {
      open: false,
      filter: "",
      selectedIndex: 0,
      items: [],
    },
    mode,
  };
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yaml = match[1] ?? "";
  const body = content.slice(match[0].length);
  const frontmatter: Record<string, unknown> = {};

  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (NUMERIC_REGEX.test(String(value))) {
      value = Number(value);
    } else if (
      typeof value === "string" &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === true) {
      lines.push(`${key}: true`);
    } else if (value === false) {
      lines.push(`${key}: false`);
    } else if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: "${String(value).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}
