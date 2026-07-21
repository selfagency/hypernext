import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldInit } from "../src/init.js";

describe("scaffoldInit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync("hypernext-init-test-");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates default directory structure", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(fs.existsSync(path.join(tmpDir, "templates"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "content"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "content", "blog"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "db"))).toBe(true);
  });

  it("creates default templates", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(fs.existsSync(path.join(tmpDir, "templates", "default.mdx"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, "templates", "blog.mdx"))).toBe(
      true
    );
  });

  it("creates config.yml", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(fs.existsSync(path.join(tmpDir, "config.yml"))).toBe(true);
    const config = fs.readFileSync(path.join(tmpDir, "config.yml"), "utf-8");
    expect(config).toContain("canonicalBase");
  });

  it("creates .gitignore and README", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "README.md"))).toBe(true);
  });

  it("creates sample content", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(
      fs.existsSync(path.join(tmpDir, "content", "blog", "getting-started.mdx"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, "content", "blog", "markdown-basics.mdx"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, "content", "blog", "using-templates.mdx"))
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "content", "about.mdx"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "content", "projects.mdx"))).toBe(
      true
    );
    expect(
      fs.existsSync(
        path.join(tmpDir, "content", "notes", "protocol-overview.mdx")
      )
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, "content", "notes", "cli-reference.mdx"))
    ).toBe(true);
  });

  it("does not overwrite existing files without force", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    const configPath = path.join(tmpDir, "config.yml");
    // Modify the file
    fs.writeFileSync(configPath, "modified", "utf-8");
    // Re-run without force
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    expect(fs.readFileSync(configPath, "utf-8")).toBe("modified");
  });

  it("overwrites existing files with force", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: true });
    const configPath = path.join(tmpDir, "config.yml");
    fs.writeFileSync(configPath, "modified", "utf-8");
    scaffoldInit(tmpDir, { force: true, skipAgentSkill: true });
    const content = fs.readFileSync(configPath, "utf-8");
    expect(content).not.toBe("modified");
    expect(content).toContain("canonicalBase");
  });

  it("creates agent skill when not skipped", () => {
    scaffoldInit(tmpDir, { force: false, skipAgentSkill: false });
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".opencode",
          "context",
          "core",
          "project-intelligence",
          "navigation.md"
        )
      )
    ).toBe(true);
  });
});
