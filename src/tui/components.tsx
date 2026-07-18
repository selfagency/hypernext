// @ts-nocheck — Ink component prop types don't align with standard React types
import { Select, TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type {
  CommandItem,
  DashboardData,
  EditorFile,
  EditorState,
  ModerationItem,
} from "./state.js";

const noop = () => {
  // No operation
};

// ── Left Pane: File Explorer ──

interface FileExplorerProps {
  activeIndex: number;
  files: EditorFile[];
  onClose: () => void;
  onSelect: (index: number) => void;
}

function FileExplorer({
  files,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  activeIndex,
  onSelect,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onClose,
}: FileExplorerProps) {
  const items = files.map((f, i) => ({
    label: `${f.isModified ? "* " : "  "}${f.slug}`,
    value: String(i),
  }));

  if (items.length === 0) {
    items.push({ label: "(no files open)", value: "-1" });
  }

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={30}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Explorer
        </Text>
        <Text bold color="red">
          [X]
        </Text>
      </Box>
      <Select onChange={(value) => onSelect(Number(value))} options={items} />
    </Box>
  );
}

// ── Center Pane: Frontmatter Form + Body Editor ──

interface FrontmatterFormProps {
  frontmatter: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}

function FrontmatterForm({ frontmatter, onUpdate }: FrontmatterFormProps) {
  const title = (frontmatter.title as string) ?? "";
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.join(", ")
    : ((frontmatter.tags as string) ?? "");

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Document Metadata
      </Text>
      <Box marginTop={1}>
        <Text width={12}>Title:</Text>
        <TextInput
          onChange={(v) => onUpdate("title", v)}
          placeholder="Post title"
          value={title}
        />
      </Box>
      <Box marginTop={1}>
        <Text width={12}>Type:</Text>
        <Select
          onChange={(v) => onUpdate("type", v)}
          options={[
            { label: "post", value: "post" },
            { label: "page", value: "page" },
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <Text width={12}>Tags:</Text>
        <TextInput
          onChange={(v) =>
            onUpdate(
              "tags",
              v
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            )
          }
          placeholder="tag1, tag2"
          value={tags}
        />
      </Box>
      <Box marginTop={1}>
        <Text width={12}>Visibility:</Text>
        <Select
          onChange={(v) => onUpdate("visibility", v)}
          options={[
            { label: "public", value: "public" },
            { label: "private", value: "private" },
          ]}
        />
      </Box>
    </Box>
  );
}

interface BodyEditorProps {
  body: string;
  onChange: (value: string) => void;
}

function BodyEditor({ body, onChange }: BodyEditorProps) {
  return (
    <Box borderStyle="single" flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="cyan">
        Body (Markdown/MDX)
      </Text>
      <Box flexGrow={1} marginTop={1}>
        <TextInput
          onChange={onChange}
          placeholder="Start writing..."
          value={body}
        />
      </Box>
    </Box>
  );
}

// ── Right Pane: Preview ──

interface PreviewPaneProps {
  body: string;
  mode: "preview" | "diagnostics";
  onClose: () => void;
  onToggleMode: () => void;
}

function PreviewPane({
  body,
  mode,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onClose,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onToggleMode,
}: PreviewPaneProps) {
  const title = mode === "preview" ? "Preview" : "Diagnostics";
  const content =
    mode === "preview"
      ? body.slice(0, 500) || "(no content)"
      : "No diagnostics.";

  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={40}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {title}
        </Text>
        <Box>
          <Text bold color="yellow">
            [Tab]
          </Text>
          <Text bold color="red">
            {" "}
            [X]
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}

// ── Dashboard Pane ──

export function DashboardPane({ data }: { data: DashboardData | null }) {
  if (!data) {
    return (
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold color="cyan">
          Dashboard
        </Text>
        <Text>Loading...</Text>
      </Box>
    );
  }
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={60}>
      <Text bold color="cyan">
        Dashboard
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Analytics (Last 7 Days)</Text>
        <Text> {data.analytics}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Moderation Queue</Text>
        <Text> Pending Mentions: {data.moderationPending}</Text>
        <Text> Spam Caught: {data.moderationSpam}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Content Stats</Text>
        <Text> Total Posts: {data.totalPosts}</Text>
        <Text> Total Docs: {data.totalDocs}</Text>
      </Box>
    </Box>
  );
}

// ── Moderation Pane ──

export function ModerationPane({
  items,
  onModerate,
}: {
  items: ModerationItem[];
  onModerate?: (id: string, status: string) => void;
}) {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={60}>
      <Text bold color="cyan">
        Moderation Queue ({items.length})
      </Text>
      {items.length === 0 && (
        <Box marginTop={1}>
          <Text color="green">No pending items.</Text>
        </Box>
      )}
      {items.map((m) => (
        <Box flexDirection="column" key={m.id} marginTop={1}>
          <Text color="yellow">
            {m.authorName} ({m.platform})
          </Text>
          <Text>{m.content.slice(0, 80)}...</Text>
          {onModerate && (
            <Box>
              <Text color="green" onPress={() => onModerate(m.id, "ham")}>
                {" "}
                [A] Approve
              </Text>
              <Text color="red" onPress={() => onModerate(m.id, "spam")}>
                {" "}
                [S] Spam
              </Text>
              <Text color="gray" onPress={() => onModerate(m.id, "delete")}>
                {" "}
                [D] Delete
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

// ── Subscribers Pane ──

interface SubscribersPaneProps {
  items: { id: string; email: string; frequency: string; verified: boolean }[];
  onDelete: (id: string) => void;
}

export function SubscribersPane({
  items,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onDelete,
}: SubscribersPaneProps) {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={60}>
      <Text bold color="cyan">
        Email Subscribers ({items.length})
      </Text>
      {items.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">No subscribers yet.</Text>
        </Box>
      )}
      {items.map((s) => (
        <Box justifyContent="space-between" key={s.id} marginTop={1}>
          <Text color={s.verified ? "green" : "yellow"}>{s.email}</Text>
          <Box>
            <Text color="gray">[{s.frequency}]</Text>
            <Text color="red"> </Text>
            <Text bold color="red">
              [D]
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ── Taxonomy Pane ──

export function TaxonomyPane() {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={60}>
      <Text bold color="cyan">
        Taxonomy Manager
      </Text>
      <Box marginTop={1}>
        <Text color="gray">
          Taxonomy management is available via the REST API.
        </Text>
      </Box>
    </Box>
  );
}

// ── Logs Pane ──

export function LogsPane() {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} width={60}>
      <Text bold color="cyan">
        System Logs
      </Text>
      <Box marginTop={1}>
        <Text color="gray">
          Logs are streamed via tslog transport. In remote mode, poll GET
          /api/v1/logs.
        </Text>
      </Box>
    </Box>
  );
}

// ── Command Palette ──

interface CommandPaletteProps {
  filter: string;
  items: CommandItem[];
  onFilterChange: (value: string) => void;
  onSelect: (item: CommandItem) => void;
  selectedIndex: number;
}

function CommandPalette({
  items,
  filter,
  selectedIndex,
  onFilterChange,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onSelect,
}: CommandPaletteProps) {
  const filtered = items.filter(
    (item) =>
      item.label.toLowerCase().includes(filter.toLowerCase()) ||
      item.id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Box
      borderColor="cyan"
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      position="absolute"
      width={60}
    >
      <Text bold color="cyan">
        Command Palette
      </Text>
      <Box marginTop={1}>
        <TextInput
          onChange={onFilterChange}
          placeholder="Type a command..."
          value={filter}
        />
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {filtered.slice(0, 10).map((item, i) => (
          <Text color={i === selectedIndex ? "cyan" : "white"} key={item.id}>
            {i === selectedIndex ? "> " : "  "}
            {item.label}
            <Text color="gray"> ({item.key})</Text>
          </Text>
        ))}
      </Box>
      <Text color="gray" marginTop={1}>
        [ESC] Dismiss | [Enter] Execute
      </Text>
    </Box>
  );
}

// ── Status Bar ──

interface StatusBarProps {
  currentFile: EditorFile | undefined;
  onOpenPalette: () => void;
  onToggleExplorer: () => void;
  onTogglePreview: () => void;
  state: EditorState;
}

function StatusBar({
  state,
  currentFile,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onToggleExplorer,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onTogglePreview,
  // biome-ignore lint/correctness/noUnusedFunctionParameters: part of interface contract
  onOpenPalette,
}: StatusBarProps) {
  const fileInfo = currentFile
    ? `${currentFile.slug}${currentFile.isModified ? " *" : ""}`
    : "(no file)";
  const modeText = state.mode === "local" ? "LOCAL" : "REMOTE";
  const dirty = currentFile?.isModified ? " [modified]" : "";

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>
        {fileInfo}
        {dirty}
      </Text>
      <Box marginLeft={2}>
        <Text color="green">[{modeText}]</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray">
          Ctrl+S Save | Ctrl+B Explorer | Ctrl+P Preview | Ctrl+D Dashboard |
          Ctrl+K Palette | Ctrl+Q Quit
        </Text>
      </Box>
    </Box>
  );
}

// ── Main Editor Layout ──

export function EditorLayout({
  state,
  files,
  onFileSelect,
  onFrontmatterUpdate,
  onBodyChange,
  onToggleExplorer,
  onTogglePreview,
  onTogglePreviewMode,
  onOpenPalette,
  onPaletteFilterChange,
  onPaletteSelect,
  onModerate,
  onDeleteSubscriber,
  subscribers,
}: {
  state: EditorState;
  files: EditorFile[];
  onFileSelect: (index: number) => void;
  onFrontmatterUpdate: (key: string, value: unknown) => void;
  onBodyChange: (value: string) => void;
  onToggleExplorer: () => void;
  onTogglePreview: () => void;
  onTogglePreviewMode: () => void;
  onOpenPalette: () => void;
  onPaletteFilterChange: (value: string) => void;
  onPaletteSelect: (item: CommandItem) => void;
  onModerate?: (id: string, status: string) => void;
  onDeleteSubscriber?: (id: string) => void;
  subscribers?: {
    id: string;
    email: string;
    frequency: string;
    verified: boolean;
  }[];
}): ReactNode {
  const activeFile =
    state.activeFileIndex >= 0 ? files[state.activeFileIndex] : undefined;

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        {state.explorerVisible && (
          <FileExplorer
            activeIndex={state.activeFileIndex}
            files={files}
            onClose={onToggleExplorer}
            onSelect={onFileSelect}
          />
        )}

        <Box flexDirection="column" flexGrow={1}>
          {activeFile ? (
            <>
              <FrontmatterForm
                frontmatter={activeFile.frontmatter}
                onUpdate={onFrontmatterUpdate}
              />
              <BodyEditor body={activeFile.content} onChange={onBodyChange} />
            </>
          ) : (
            <Box
              alignItems="center"
              flexDirection="column"
              flexGrow={1}
              justifyContent="center"
            >
              <Text>Open a file to start editing</Text>
            </Box>
          )}
        </Box>

        {state.previewVisible && (
          <PreviewPane
            body={activeFile?.content ?? ""}
            mode={state.previewMode}
            onClose={onTogglePreview}
            onToggleMode={onTogglePreviewMode}
          />
        )}

        {state.dashboardVisible && <DashboardPane data={state.dashboardData} />}

        {state.moderationVisible && (
          <ModerationPane
            items={state.moderationItems}
            onModerate={onModerate}
          />
        )}

        {state.taxonomyVisible && <TaxonomyPane />}

        {state.logsVisible && <LogsPane />}

        {state.subscribersVisible && subscribers && (
          <SubscribersPane
            items={subscribers}
            onDelete={onDeleteSubscriber ?? noop}
          />
        )}
      </Box>

      <StatusBar
        currentFile={activeFile}
        onOpenPalette={onOpenPalette}
        onToggleExplorer={onToggleExplorer}
        onTogglePreview={onTogglePreview}
        state={state}
      />

      {state.commandPalette.open && (
        <CommandPalette
          filter={state.commandPalette.filter}
          items={state.commandPalette.items}
          onFilterChange={onPaletteFilterChange}
          onSelect={onPaletteSelect}
          selectedIndex={state.commandPalette.selectedIndex}
        />
      )}
    </Box>
  );
}
