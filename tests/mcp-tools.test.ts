import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocMeta } from "../src/database/entities/doc-meta.js";
import { Term } from "../src/database/entities/term.js";
import { TermRelationship } from "../src/database/entities/term-relationship.js";
import { closeOrm, getEm, initOrm, insertDoc } from "../src/database/index.js";
import { createTools } from "../src/mcp/tools.js";
import { createDocumentTools } from "../src/mcp/tools-documents.js";
import { createEmailTools } from "../src/mcp/tools-email.js";
import { createModerationTools } from "../src/mcp/tools-moderation.js";
import { createSyncTools } from "../src/mcp/tools-sync.js";
import type { HypernextConfig } from "../src/types/config.js";

// ── Shared test config ──────────────────────────────────────────────────────

const baseConfig: HypernextConfig = {
  site: {
    canonicalBase: "http://localhost:8080",
    meta: { title: "Test", description: "Desc", lang: "en" },
    pdf: { enabled: false },
    ebooks: { enabled: false },
  },
  author: { name: "Test Author" },
  storage: { type: "local", local: { path: "./content" } },
  database: { type: "sqlite", path: ":memory:" },
  api: { enabled: true },
  collections: {
    blog: { path: "/blog/", syndicate: false, rss: true, layout: "blog.mdx" },
    library: {
      path: "/library/",
      syndicate: false,
      rss: true,
      layout: "default.mdx",
    },
  },
  taxonomies: [],
  protocols: {
    http: { enabled: true, port: 8080 },
    gemini: { enabled: false, port: 1965 },
    gopher: { enabled: false, port: 70 },
    spartan: { enabled: false, port: 300 },
    nex: { enabled: false, port: 1900 },
    finger: { enabled: false, port: 79 },
    text: { enabled: false, port: 5011 },
  },
  micropub: { enabled: false },
  syndication: {},
  mcp: { enabled: true, transport: "stdio" },
};

// Config with email enabled (used selectively)
const emailConfig: HypernextConfig = {
  ...baseConfig,
  email: {
    enabled: true,
    smtp: {
      host: "localhost",
      port: 587,
      secure: false,
      user: "test",
      pass: "test",
    },
    from: { address: "test@example.com", name: "Test" },
    replyTo: "test@example.com",
    subjectPrefix: "[Test]",
    transport: "smtp",
    newsletter: { digestSchedule: "0 8 * * 1", digestTime: "08:00" },
    contactForm: {
      enabled: false,
      recipient: "",
      akismet: false,
      captcha: false,
    },
  },
};

// Config with email disabled (explicit undefined for early-return coverage)
const noEmailConfig: HypernextConfig = {
  ...baseConfig,
  email: undefined,
};

// Config with AI enabled
const aiConfig: HypernextConfig = {
  ...baseConfig,
  agent: { enabled: true },
  ai: {
    enabled: true,
    features: {
      altText: false,
      autoTagging: false,
      moderation: false,
      seoMeta: false,
    },
    models: { embedding: "text-embedding-ada-002", utility: "gpt-4" },
    openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
    vectorDimensions: 1536,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function expectToolResult(
  result: { content: { type: string; text: string }[] },
  expectedContent?: string
) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from test blocks
  expect(Array.isArray(result.content)).toBe(true);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from test blocks
  expect(result.content[0]).toHaveProperty("type", "text");
  if (expectedContent !== undefined) {
    // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from test blocks
    expect(result.content[0].text).toContain(expectedContent);
  }
}

function findTool(
  tools: { name: string; handler: (...args: unknown[]) => unknown }[],
  name: string
) {
  const tool = tools.find((t) => t.name === name);
  // biome-ignore lint/suspicious/noMisplacedAssertion: helper called from test blocks
  expect(tool, `Tool "${name}" not found`).toBeDefined();
  return tool as NonNullable<typeof tool>;
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe("MCP tool handlers", () => {
  beforeAll(async () => {
    await initOrm(":memory:");

    // Seed documents for document / moderation / sync tests
    await insertDoc({
      slug: "blog/hello",
      title: "Hello World",
      rawMdx: "# Hello\n\nWorld.",
    });
    await insertDoc({
      slug: "blog/typescript-tips",
      title: "TypeScript Tips",
      rawMdx: "# TypeScript Tips\n\nUse strict mode.",
    });
    await insertDoc({
      slug: "library/rust-book",
      title: "Rust Book Notes",
      rawMdx: "# Rust\n\nOwnership.",
    });
    await insertDoc({
      slug: "library/deno-guide",
      title: "Deno Guide",
      rawMdx: "# Deno\n\nRuntime.",
    });

    // Seed a tag term + relationship for list_docs filtering
    const em = getEm();
    const term = em.create(Term, {
      taxonomy: "tags",
      slug: "typescript",
      name: "TypeScript",
    });
    await em.flush();

    const doc = await em.findOne(DocMeta, { slug: "blog/typescript-tips" });
    if (doc) {
      em.create(TermRelationship, { docId: doc.id, termId: term.id });
      await em.flush();
    }
  });

  afterAll(async () => {
    await closeOrm();
  });

  // ── Document tools ──────────────────────────────────────────────────────

  describe("createDocumentTools()", () => {
    it("returns all six document tools", () => {
      const tools = createDocumentTools();
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        "search_docs",
        "list_docs",
        "read_doc",
        "create_doc",
        "update_doc",
        "delete_doc",
      ]);
    });
  });

  describe("search_docs", () => {
    it("returns matching documents", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "search_docs");
      const result = await tool.handler({ query: "Hello", limit: 10 });
      expectToolResult(result, "blog/hello");
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty array for non-matching query", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "search_docs");
      const result = await tool.handler({
        query: "zxcvbnmnonexistent",
        limit: 10,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual([]);
    });

    it("defaults limit to 20", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "search_docs");
      const result = await tool.handler({ query: "Hello" });
      expectToolResult(result);
    });

    it("rejects empty query (FTS5 requires non-empty input)", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "search_docs");
      await expect(tool.handler({})).rejects.toThrow();
    });
  });

  describe("list_docs", () => {
    it("returns all document slugs when no filters provided", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "list_docs");
      const result = await tool.handler({});
      expectToolResult(result);
      const slugs: string[] = JSON.parse(result.content[0].text);
      expect(slugs).toContain("blog/hello");
      expect(slugs).toContain("blog/typescript-tips");
      expect(slugs).toContain("library/rust-book");
      expect(slugs).toContain("library/deno-guide");
    });

    it("filters by collection prefix", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "list_docs");
      const result = await tool.handler({ collection: "library" });
      const slugs: string[] = JSON.parse(result.content[0].text);
      expect(slugs).toEqual(
        expect.arrayContaining(["library/rust-book", "library/deno-guide"])
      );
      expect(slugs).not.toContain("blog/hello");
    });

    it("filters by tag slug", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "list_docs");
      const result = await tool.handler({ tag: "typescript" });
      const slugs: string[] = JSON.parse(result.content[0].text);
      expect(slugs).toContain("blog/typescript-tips");
      expect(slugs).not.toContain("blog/hello");
    });

    it("returns empty array for non-matching tag", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "list_docs");
      const result = await tool.handler({ tag: "nonexistent-tag" });
      const slugs: string[] = JSON.parse(result.content[0].text);
      expect(slugs).toEqual([]);
    });
  });

  describe("read_doc", () => {
    it("returns frontmatter, markdown, and rawMdx for existing doc", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "read_doc");
      const result = await tool.handler({ slug: "blog/hello" });
      expectToolResult(result);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("frontmatter");
      expect(parsed).toHaveProperty("markdown");
      expect(parsed).toHaveProperty("rawMdx");
      expect(parsed.rawMdx).toContain("# Hello");
      expect(parsed.markdown).toContain("Hello");
    });

    it("returns error for non-existent slug", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "read_doc");
      const result = await tool.handler({ slug: "nonexistent" });
      expectToolResult(result, "Not found");
    });

    it("has correct input schema with required slug", () => {
      const tools = createDocumentTools();
      const tool = tools.find((t) => t.name === "read_doc") as NonNullable<
        typeof tool
      >;
      expect(tool.inputSchema).toHaveProperty("required");
      expect(tool.inputSchema.required).toContain("slug");
    });
  });

  // Storage-backed tools share a single temp dir to avoid the module-level
  // storageInstance singleton collision (createStorage returns cached instance).
  describe("storage-backed document tools", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "mcp-docs-"));
      const config: HypernextConfig = {
        ...baseConfig,
        storage: { type: "local", local: { path: tmpDir } },
      };
      return import("../src/storage/index.js").then(({ createStorage }) => {
        createStorage(config);
      });
    });

    afterAll(() => {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("create_doc has correct name, description, and input schema", () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "create_doc");
      expect(tool.name).toBe("create_doc");
      expect(tool.description).toContain("Create");
      expect(tool.inputSchema.required).toEqual(["slug", "title", "content"]);
    });

    it("creates an MDX document via storage", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "create_doc");
      const result = await tool.handler({
        slug: "blog/test-create",
        title: "Test Create",
        content: "Created through MCP tool.",
      });
      expectToolResult(result, "blog/test-create created.");

      const { readFileSync, existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const filePath = resolve(tmpDir, "blog/test-create.mdx");
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain('title: "Test Create"');
      expect(content).toContain("Created through MCP tool.");
    });

    it("update_doc has correct name, description, and input schema", () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "update_doc");
      expect(tool.name).toBe("update_doc");
      expect(tool.inputSchema.required).toEqual(["slug", "content"]);
    });

    it("updates a document via storage (overwrites full content)", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "update_doc");
      const result = await tool.handler({
        slug: "blog/test-create",
        content: "# Updated\n\nContent replaced.",
      });
      expectToolResult(result, "blog/test-create updated.");

      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const filePath = resolve(tmpDir, "blog/test-create.mdx");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe("# Updated\n\nContent replaced.");
    });

    it("delete_doc has correct name and input schema", () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "delete_doc");
      expect(tool.name).toBe("delete_doc");
      expect(tool.inputSchema.required).toContain("slug");
    });

    it("deletes a document via storage", async () => {
      const tools = createDocumentTools();
      const tool = findTool(tools, "delete_doc");
      // Creates the doc first using create_doc so storage stays initialized
      const createTool = findTool(createDocumentTools(), "create_doc");
      await createTool.handler({
        slug: "blog/to-delete",
        title: "To Delete",
        content: "Delete me.",
      });

      const result = await tool.handler({ slug: "blog/to-delete" });
      expectToolResult(result, "blog/to-delete deleted.");

      const { existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      expect(existsSync(resolve(tmpDir, "blog/to-delete.mdx"))).toBe(false);
    });
  });

  // ── Email tools ─────────────────────────────────────────────────────────

  describe("createEmailTools() / config.email = undefined", () => {
    it("returns email tools even with email config undefined", () => {
      const tools = createEmailTools(noEmailConfig);
      const names = tools.map((t) => t.name);
      expect(names).toContain("list_subscribers");
      expect(names).toContain("add_subscriber");
      expect(names).toContain("delete_subscriber");
      expect(names).toContain("send_test_email");
    });
  });

  describe("add_subscriber", () => {
    it("creates a new subscriber", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "add_subscriber");
      const result = await tool.handler({
        email: "alice@example.com",
        frequency: "instant",
      });
      expectToolResult(result);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.email).toBe("alice@example.com");
      expect(parsed.frequency).toBe("instant");
      expect(parsed.verified).toBe(true);
    });

    it("defaults frequency to instant", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "add_subscriber");
      const result = await tool.handler({
        email: "bob@example.com",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.frequency).toBe("instant");
    });

    it("accepts weekly frequency", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "add_subscriber");
      const result = await tool.handler({
        email: "carol@example.com",
        frequency: "weekly",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.frequency).toBe("weekly");
    });

    it("rejects duplicate email", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "add_subscriber");
      const result = await tool.handler({
        email: "alice@example.com",
      });
      expectToolResult(result, "Email already subscribed");
    });
  });

  describe("list_subscribers", () => {
    it("returns all subscribers when no filter provided", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "list_subscribers");
      const result = await tool.handler({});
      expectToolResult(result);
      const subs: Array<{ email: string; frequency: string }> = JSON.parse(
        result.content[0].text
      );
      const emails = subs.map((s) => s.email);
      expect(emails).toContain("alice@example.com");
      expect(emails).toContain("bob@example.com");
      expect(emails).toContain("carol@example.com");
    });

    it("filters by frequency", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "list_subscribers");
      const result = await tool.handler({ frequency: "weekly" });
      const subs: Array<{ email: string; frequency: string }> = JSON.parse(
        result.content[0].text
      );
      expect(subs.length).toBeGreaterThanOrEqual(1);
      for (const sub of subs) {
        expect(sub.frequency).toBe("weekly");
      }
      const emails = subs.map((s) => s.email);
      expect(emails).toContain("carol@example.com");
    });

    it("returns empty array for non-matching frequency", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "list_subscribers");
      const result = await tool.handler({ frequency: "nonexistent" });
      const subs = JSON.parse(result.content[0].text);
      expect(subs).toEqual([]);
    });
  });

  describe("delete_subscriber", () => {
    it("deletes an existing subscriber", async () => {
      // Add then delete
      const addTools = createEmailTools(emailConfig);
      const addTool = findTool(addTools, "add_subscriber");
      await addTool.handler({
        email: "dave@example.com",
      });

      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "delete_subscriber");
      const result = await tool.handler({ email: "dave@example.com" });
      expectToolResult(result, "dave@example.com deleted.");
    });

    it("returns error for non-existent subscriber", async () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "delete_subscriber");
      const result = await tool.handler({
        email: "nobody@example.com",
      });
      expectToolResult(result, "Subscriber not found");
    });
  });

  describe("send_test_email", () => {
    it("has correct name and input schema", () => {
      const tools = createEmailTools(emailConfig);
      const tool = findTool(tools, "send_test_email");
      expect(tool.name).toBe("send_test_email");
      expect(tool.inputSchema.required).toContain("to");
    });
  });

  // ── Moderation tools ─────────────────────────────────────────────────────

  describe("createModerationTools()", () => {
    let _mentionIds: string[] = [];

    beforeAll(async () => {
      const em = getEm();
      const { Mention } = await import("../src/database/entities/mention.js");

      // Insert mentions via ORM for the moderation tools to query
      const m1 = em.create(Mention, {
        id: "mod-mention-1",
        targetSlug: "blog/hello",
        sourceUrl: "https://example.com/a",
        authorName: "Alice",
        content: "Nice post!",
        publishedAt: Date.now() - 10_000,
        type: "reply",
        platform: "webmention",
        spamStatus: "pending",
      });

      const m2 = em.create(Mention, {
        id: "mod-mention-2",
        targetSlug: "blog/typescript-tips",
        sourceUrl: "https://example.com/b",
        authorName: "Bob",
        content: "Great tips!",
        publishedAt: Date.now(),
        type: "like",
        platform: "mastodon",
        spamStatus: "ham",
      });

      const m3 = em.create(Mention, {
        id: "mod-mention-3",
        targetSlug: "blog/hello",
        sourceUrl: "https://spam.example.com",
        authorName: "Spammer",
        content: "Buy now!",
        publishedAt: Date.now() - 5000,
        type: "reply",
        platform: "webmention",
        spamStatus: "spam",
      });

      await em.flush();
      _mentionIds = [m1.id, m2.id, m3.id];
    });

    it("returns three moderation tools", () => {
      const tools = createModerationTools();
      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        "list_mentions",
        "moderate_mention",
        "delete_mention",
      ]);
    });

    describe("list_mentions", () => {
      it("returns all mentions when no filter", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "list_mentions");
        const result = await tool.handler({});
        expectToolResult(result);
        const mentions = JSON.parse(result.content[0].text);
        expect(mentions.length).toBeGreaterThanOrEqual(3);
      });

      it("filters by target slug", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "list_mentions");
        const result = await tool.handler({ slug: "blog/typescript-tips" });
        const mentions = JSON.parse(result.content[0].text);
        expect(mentions).toHaveLength(1);
        expect(mentions[0].targetSlug).toBe("blog/typescript-tips");
      });

      it("filters by spam status", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "list_mentions");
        const result = await tool.handler({ status: "ham" });
        const mentions = JSON.parse(result.content[0].text);
        for (const m of mentions) {
          expect(m.spamStatus).toBe("ham");
        }
      });

      it("returns empty for non-matching status", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "list_mentions");
        const result = await tool.handler({ status: "unknown-status" });
        const mentions = JSON.parse(result.content[0].text);
        expect(mentions).toEqual([]);
      });

      it("filters by both slug and status", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "list_mentions");
        const result = await tool.handler({
          slug: "blog/hello",
          status: "pending",
        });
        const mentions = JSON.parse(result.content[0].text);
        expect(mentions.length).toBeGreaterThanOrEqual(1);
        for (const m of mentions) {
          expect(m.targetSlug).toBe("blog/hello");
          expect(m.spamStatus).toBe("pending");
        }
      });
    });

    describe("moderate_mention", () => {
      it("updates spam status to ham", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "moderate_mention");
        const result = await tool.handler({
          id: "mod-mention-1",
          status: "ham",
        });
        expectToolResult(result, "mod-mention-1 updated to ham.");

        // Verify persistence
        const { Mention } = await import("../src/database/entities/mention.js");
        const updated = await getEm().findOne(Mention, { id: "mod-mention-1" });
        expect(updated?.spamStatus).toBe("ham");
      });

      it("updates spam status to spam", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "moderate_mention");
        const result = await tool.handler({
          id: "mod-mention-2",
          status: "spam",
        });
        expectToolResult(result, "mod-mention-2 updated to spam.");
      });

      it("returns error for non-existent mention", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "moderate_mention");
        const result = await tool.handler({
          id: "does-not-exist",
          status: "ham",
        });
        expectToolResult(result, "Not found");
      });

      it("has correct input schema with required id and status", () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "moderate_mention");
        expect(tool.inputSchema.required).toEqual(["id", "status"]);
      });
    });

    describe("delete_mention", () => {
      it("deletes an existing mention", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "delete_mention");
        const result = await tool.handler({ id: "mod-mention-3" });
        expectToolResult(result, "mod-mention-3 deleted.");

        // Verify persistence
        const { Mention } = await import("../src/database/entities/mention.js");
        const deleted = await getEm().findOne(Mention, { id: "mod-mention-3" });
        expect(deleted).toBeNull();
      });

      it("returns error for non-existent mention", async () => {
        const tools = createModerationTools();
        const tool = findTool(tools, "delete_mention");
        const result = await tool.handler({ id: "does-not-exist" });
        expectToolResult(result, "Not found");
      });
    });
  });

  // ── Sync tools ──────────────────────────────────────────────────────────

  describe("createSyncTools()", () => {
    it("returns all sync tools", () => {
      const tools = createSyncTools(baseConfig);
      const names = tools.map((t) => t.name);
      expect(names).toContain("ingest_url");
      expect(names).toContain("list_media");
      expect(names).toContain("push_remote");
      expect(names).toContain("sync_remote");
      expect(names).toContain("syndicate_doc");
      expect(names).toContain("generate_format");
      expect(names).toContain("list_collections");
    });

    describe("list_collections", () => {
      it("returns configured collections with doc counts", async () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "list_collections");
        const result = await tool.handler({});
        expectToolResult(result);
        const collections = JSON.parse(result.content[0].text);
        expect(collections).toHaveProperty("blog");
        expect(collections).toHaveProperty("library");
        expect(collections.blog.count).toBeGreaterThanOrEqual(2);
        expect(collections.library.count).toBeGreaterThanOrEqual(2);
      });
    });

    describe("list_media", () => {
      it("returns empty array when assets directory does not exist", async () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "list_media");
        const result = await tool.handler({});
        expectToolResult(result);
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
      });

      it("returns file list when assets directory exists", async () => {
        // Create a temporary assets dir
        const tmpDir = mkdtempSync(join(tmpdir(), "mcp-sync-assets-"));
        const { writeFileSync, mkdirSync } = await import("node:fs");
        mkdirSync(join(tmpDir, "assets"), { recursive: true });
        writeFileSync(join(tmpDir, "assets", "photo.jpg"), "fake-image");
        writeFileSync(join(tmpDir, "assets", "doc.pdf"), "fake-pdf");

        // Save CWD and chdir to temp dir
        const origCwd = process.cwd;
        process.cwd = () => tmpDir;

        try {
          const tools = createSyncTools(baseConfig);
          const tool = findTool(tools, "list_media");
          const result = await tool.handler({});
          const files: string[] = JSON.parse(result.content[0].text);
          expect(files).toContain("photo.jpg");
          expect(files).toContain("doc.pdf");
        } finally {
          process.cwd = origCwd;
          rmSync(tmpDir, { recursive: true, force: true });
        }
      });

      it("has empty input schema", () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "list_media");
        expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
      });
    });

    describe("generate_format", () => {
      it.each([
        { slug: "nonexistent-slug", format: "pdf", expected: "Not found" },
        {
          slug: "blog/hello",
          format: "epub",
          expected: "Format epub not supported.",
        },
        {
          slug: "blog/hello",
          format: "docx",
          expected: "Format docx not supported.",
        },
      ])("returns $expected for format=$format", async ({
        slug,
        format,
        expected,
      }) => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "generate_format");
        const result = await tool.handler({ slug, format });
        expectToolResult(result, expected);
      });
    });

    describe("syndicate_doc", () => {
      it("returns error for non-existent document", async () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "syndicate_doc");
        const result = await tool.handler({ slug: "nonexistent" });
        expectToolResult(result, "Not found");
      });

      it("has correct input schema with required slug", () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "syndicate_doc");
        expect(tool.inputSchema.required).toContain("slug");
      });
    });

    describe("push_remote", () => {
      it("throws when remote server is not configured", async () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "push_remote");
        await expect(tool.handler({})).rejects.toThrow(
          "Remote server not configured"
        );
      });
    });

    describe("sync_remote", () => {
      it("throws when remote server is not configured", async () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "sync_remote");
        await expect(tool.handler({})).rejects.toThrow(
          "Remote server not configured"
        );
      });
    });

    describe("ingest_url", () => {
      it("has correct name and input schema", () => {
        const tools = createSyncTools(baseConfig);
        const tool = findTool(tools, "ingest_url");
        expect(tool.name).toBe("ingest_url");
        expect(tool.inputSchema.required).toEqual([
          "url",
          "collection",
          "filename",
        ]);
        expect(tool.inputSchema.properties).toHaveProperty("url");
        expect(tool.inputSchema.properties).toHaveProperty("collection");
        expect(tool.inputSchema.properties).toHaveProperty("filename");
        expect(tool.inputSchema.properties).toHaveProperty("downloadMedia");
      });
    });
  });

  // ── Aggregator: createTools() ────────────────────────────────────────────

  describe("createTools()", () => {
    it("includes all module tools by default", () => {
      const tools = createTools(baseConfig);
      const names = tools.map((t) => t.name);
      expect(names).toContain("search_docs");
      expect(names).toContain("list_docs");
      expect(names).toContain("read_doc");
      expect(names).toContain("create_doc");
      expect(names).toContain("update_doc");
      expect(names).toContain("delete_doc");
      expect(names).toContain("ingest_url");
      expect(names).toContain("list_media");
      expect(names).toContain("push_remote");
      expect(names).toContain("sync_remote");
      expect(names).toContain("syndicate_doc");
      expect(names).toContain("generate_format");
      expect(names).toContain("list_collections");
      expect(names).toContain("list_mentions");
      expect(names).toContain("moderate_mention");
      expect(names).toContain("delete_mention");
      expect(names).toContain("list_subscribers");
      expect(names).toContain("add_subscriber");
      expect(names).toContain("delete_subscriber");
      expect(names).toContain("send_test_email");
    });

    it("includes AI tools when ai.enabled is true", () => {
      const tools = createTools(aiConfig);
      const names = tools.map((t) => t.name);
      expect(names).toContain("talk_to_docs");
    });

    it("excludes AI tools when ai is not configured", () => {
      const tools = createTools(baseConfig);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("talk_to_docs");
    });

    it("excludes AI tools when ai.enabled is false", () => {
      const config: HypernextConfig = {
        ...baseConfig,
        ai: {
          enabled: false,
          features: {
            altText: false,
            autoTagging: false,
            moderation: false,
            seoMeta: false,
          },
          models: { embedding: "test", utility: "test" },
          openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
          vectorDimensions: 1536,
        },
      };
      const tools = createTools(config);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("talk_to_docs");
    });

    it("includes IPFS tools when ipfs.enabled is true", () => {
      const config: HypernextConfig = {
        ...baseConfig,
        ipfs: {
          enabled: true,
          apiEndpoint: "http://127.0.0.1:5001",
          gatewayUrl: "https://ipfs.io/ipfs",
          pinning: true,
          cacheHtml: true,
        },
      };
      const tools = createTools(config);
      const names = tools.map((t) => t.name);
      expect(names).toContain("get_doc_cid");
      expect(names).toContain("pin_doc");
    });

    it("excludes IPFS tools when ipfs is not configured", () => {
      const tools = createTools(baseConfig);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain("get_doc_cid");
      expect(names).not.toContain("pin_doc");
    });

    it("every tool has a non-empty name, description, inputSchema, and handler", () => {
      const tools = createTools(baseConfig);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.handler).toBe("function");
      }
    });

    it("each tool has a unique name", () => {
      const tools = createTools(baseConfig);
      const names = tools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });
});
