import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { e2e, setupE2e, teardownE2e } from "./setup.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  await setupE2e();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  try {
    if (page) {
      await page.close();
    }
  } catch {
    // Ignore close errors
  }
  try {
    if (browser) {
      await browser.close();
    }
  } catch {
    // Ignore close errors
  }
  await teardownE2e();
}, 30_000);

describe("HTML E2E", () => {
  it("renders h-entry microformats on a blog post", async () => {
    await page.goto(`${e2e.config.site.canonicalBase}/blog/welcome`);

    const hEntry = page.locator(".h-entry").first();
    await expect(hEntry.isVisible()).resolves.toBe(true);

    const title = page.locator(".h-entry .p-name").first();
    await expect(title.textContent()).resolves.toContain(
      "Welcome to Hypernext"
    );

    const published = page.locator(".h-entry .dt-published").first();
    await expect(published.isVisible()).resolves.toBe(true);

    const url = page.locator(".h-entry .u-url").first();
    await expect(url.isVisible()).resolves.toBe(true);
  });

  it("renders the Comments section with Replies heading", async () => {
    await page.goto(`${e2e.config.site.canonicalBase}/blog/with-comments`);

    const comments = page
      .locator(".h-feed.comments, [id='comments'], .comments")
      .first();
    await expect(comments.isVisible()).resolves.toBe(true);

    const heading = page.getByText("Replies", { exact: true });
    await expect(heading.isVisible()).resolves.toBe(true);
  });

  it("returns 404 for a private document over HTTP", async () => {
    const response = await page.goto(
      `${e2e.config.site.canonicalBase}/blog/private`
    );
    expect(response?.status()).toBe(404);
  });
});
