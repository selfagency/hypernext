# Supplementary Plan: End-to-End (E2E) Testing Strategy

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Define a comprehensive E2E testing strategy using Vitest to validate full-stack functionality across HTTP (browser-based), Smolnet protocols (TCP/TLS socket-based), the REST API, IndieAuth, and the Federation/Mentions pipeline.

---

## 1. Testing Infrastructure & Tooling

To test both modern web interfaces and retro-protocol servers, we need a hybrid approach.

*   **Test Runner:** `Vitest` (integrates natively with the Vite build pipeline).
*   **Browser Testing:** `@vitest/browser` powered by `Playwright`. This allows us to render actual HTML, execute client-side scripts (if any), and test Microformats2 DOM structures.
*   **TCP/TLS Socket Testing:** Custom Node.js `net` and `tls` clients to speak raw Gopher, Spartan, NEX, Text, and Finger protocols.
*   **Mock External Services:** Local Fastify servers mimicking Mastodon, Bluesky, and Akismet APIs to test POSSE syndication and spam filtering without hitting real endpoints.
*   **Worker Synchronization Utility:** A helper function to pause test execution until the `workmatic` queue is empty, ensuring background indexing/mention processing is complete before asserting.

---

## 2. Test Environment Setup (`tests/setup.ts`)

Before any tests run, the setup file initializes an isolated test environment.

1.  **Temp Directories:** Create a temporary `content/` directory seeded with known MDX fixtures (e.g., a blog post with `<Comments />`, a private page).
2.  **Ephemeral Ports:** Assign random high-ports (e.g., `0` for OS-assigned) for HTTP, Gemini, Gopher, etc., to avoid CI collisions.
3.  **Start Hypernext:** Programmatically boot the Hypernext server (`startServer(config)`).
4.  **Start Mock APIs:** Boot mock Mastodon/Bluesky/Akismet Fastify servers.
5.  **Teardown:** Kill all servers and delete temp directories after the suite finishes.

---

## 3. HTTP & API E2E Tests (Browser & Node `fetch`)

We use `@vitest/browser` for HTML/DOM validation and standard Node `fetch` for API endpoints.

### Test Cases:
1.  **HTML Rendering & Microformats2:**
    *   Navigate to `http://localhost:{port}/blog/welcome`.
    *   Assert DOM contains `<article class="h-entry">`.
    *   Assert presence of `<a class="u-url">` and `<time class="dt-published">`.
2.  **Headless REST API:**
    *   `GET /api/v1/docs` -> Assert 200 OK and JSON array contains the welcome post.
    *   `GET /api/v1/docs/blog/welcome.pdf` -> Assert `Content-Type` is `application/pdf` and buffer starts with `%PDF`.
3.  **IndieAuth Flow (Mocked Client):**
    *   Simulate a client redirecting to `/.well-known/oauth-authorization-endpoint`.
    *   Mock user approval, follow redirects, and exchange the code for a Bearer token.
    *   Use the token to `POST /micropub` with a new post payload.
    *   Assert `201 Created` and verify the new MDX file exists in the temp `content/` directory.

---

## 4. Smolnet Protocol E2E Tests (Socket Clients)

Since browsers cannot speak Gopher or Spartan, we use Node's `net` (TCP) and `tls` (TLS) modules to send raw bytes and assert raw responses.

### Test Cases:
1.  **Gemini (TLS):**
    *   Connect via `tls.connect({ rejectUnauthorized: false })`.
    *   Send `gemini://localhost:{port}/blog/welcome\r\n`.
    *   Assert response starts with `20 text/gemini; charset=utf-8\r\n`.
    *   Assert body contains `# Welcome` (flattened from HTML/MDX).
2.  **Spartan (TCP):**
    *   Connect via `net.connect`.
    *   Send `localhost {port} /blog/welcome 0\r\n`.
    *   Assert response starts with `2 text/gemini\r\n`.
3.  **Gopher (TCP):**
    *   Connect via `net.connect`.
    *   Send `/blog/welcome\r\n`.
    *   Assert response contains the text body, followed by `.\r\n` terminator.
4.  **NEX (TCP):**
    *   Connect via `net.connect`.
    *   Send `/library/\r\n`.
    *   Assert response is raw bytes with `=> /library/page1 Page 1` (directory listing format).
5.  **Privacy Enforcement:**
    *   Request a `visibility: private` document via Gopher.
    *   Assert response is `51 Not Found\r\n` (or equivalent error), ensuring no data leakage.

---

## 5. Federation, Mentions & Spam E2E Tests

This suite tests the entire inbound/outbound pipeline, including the `workmatic` background queue.

### Test Cases:
1.  **Inbound Webmention & Akismet (Spam Detection):**
    *   Start a mock HTTP server representing the "source" of the mention. Serve an HTML page containing a link to our target post, with spammy keywords.
    *   `POST /webmention` with `source=http://mock-source/spam` and `target=http://localhost/blog/welcome`.
    *   *Wait for `workmatic` queue to drain.*
    *   `GET /api/v1/mentions?status=spam`.
    *   Assert the mention appears in the API response with `spam_status: 'spam'` (because the mock Akismet returned `true`).
2.  **POSSE Reply Aggregation (Mastodon/Bluesky):**
    *   Ensure a post is syndicated (mock Mastodon returns a fake Post ID, stored in SQLite).
    *   Configure mock Mastodon `/api/v1/statuses/{id}/context` to return a dummy reply.
    *   `GET /blog/welcome` via browser (triggering the lazy `<Comments />` fetch).
    *   *Wait for `workmatic` queue to drain.*
    *   Assert the HTML DOM now contains a `<div class="h-card">` with the mock Mastodon author's name.
3.  **Granular Frontmatter Controls:**
    *   Create a post with `comments.inbound.webmention: false` in frontmatter.
    *   `POST /webmention` targeting this specific post.
    *   Assert HTTP response is `403 Forbidden`.

---

## 6. Example Test Implementations

### A. Testing Spartan Protocol via Raw TCP Socket
```typescript
// tests/e2e/spartan.test.ts
import net from 'net';
import { describe, it, expect } from 'vitest';
import { testState } from '../setup';

describe('Spartan Protocol E2E', () => {
  it('should return gemtext for a valid request', async () => {
    const port = testState.ports.spartan;
    const response = await new Promise<string>((resolve) => {
      const client = net.connect(port, 'localhost', () => {
        // Spartan format: host SP path SP content-length CRLF
        client.write(`localhost /blog/welcome 0\r\n`);
      });
      let data = '';
      client.on('data', (chunk) => data += chunk.toString());
      client.on('end', () => resolve(data));
    });

    // Spartan success status is '2'
    expect(response.startsWith('2 text/gemini\r\n')).toBe(true);
    expect(response).toContain('# Welcome to Hypernext');
  });
});
```

### B. Testing Webmention + Worker Queue Sync
```typescript
// tests/e2e/webmention.test.ts
import { describe, it, expect } from 'vitest';
import { testState, waitForWorkmatic } from '../setup';
import { startMockSourceServer } from '../helpers/mockSource';

describe('Inbound Webmentions E2E', () => {
  it('should process a webmention, check Akismet, and store it', async () => {
    // 1. Start a mock server representing the source URL
    const sourcePort = await startMockSourceServer(`
      <div class="h-entry">
        <a class="u-in-reply-to" href="http://localhost:${testState.ports.http}/blog/welcome"></a>
        <p class="p-content">Great post!</p>
      </div>
    `);

    // 2. Send the Webmention ping
    const res = await fetch(`http://localhost:${testState.ports.http}/webmention`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `source=http://localhost:${sourcePort}/&target=http://localhost:${testState.ports.http}/blog/welcome`
    });
    expect(res.status).toBe(202);

    // 3. Wait for the workmatic queue to finish processing
    await waitForWorkmatic();

    // 4. Assert via Moderation API
    const apiRes = await fetch(`http://localhost:${testState.ports.http}/api/v1/mentions?slug=/blog/welcome`, {
      headers: { 'Authorization': `Bearer ${testState.apiKey}` }
    });
    const { data } = await apiRes.json();
    
    expect(data.length).toBe(1);
    expect(data[0].author_name).toBe('Mock Author');
    expect(data[0].spam_status).toBe('ham'); // Assuming mock Akismet returns false
  });
});
```

### C. Testing Browser UI & Microformats2
```typescript
// tests/e2e/html.test.ts
import { describe, it, expect } from 'vitest';
import { page } from '@vitest/browser';
import { testState } from '../setup';

describe('HTML UI & mf2 E2E', () => {
  it('should render h-entry microformats correctly', async () => {
    await page.goto(`http://localhost:${testState.ports.http}/blog/welcome`);

    // Vitest browser provides DOM testing utilities
    const hEntry = await page.elementSelector('.h-entry');
    expect(hEntry).not.toBeNull();

    const pName = await page.elementSelector('.h-entry .p-name');
    expect(await pName.text()).toBe('Welcome to Hypernext');

    // Check if syndication links are present
    const uSyndication = await page.elementSelector('.u-syndication');
    expect(uSyndication).not.toBeNull();
  });
});
```

---

## 7. Worker Synchronization Utility (`tests/helpers/waitForWorkmatic.ts`)

Because `workmatic` executes tasks asynchronously in a thread pool, tests need a deterministic way to know when the queue is empty. We expose a test-only endpoint or utility.

```typescript
// tests/setup.ts
import { getWorkmaticQueueStatus } from '../../src/federation/queue';

export async function waitForWorkmatic(timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { pending, active } = getWorkmaticQueueStatus();
    if (pending === 0 && active === 0) {
      return;
    }
    await new Promise(r => setTimeout(r, 50)); // Poll every 50ms
  }
  throw new Error('Timeout waiting for workmatic queue to drain');
}
```

---

## 8. CI/CD Integration

These E2E tests will run automatically in GitHub Actions.

```yaml
# .github/workflows/ci.yml (E2E Job Excerpt)
jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install --frozen-lockfile
      - name: Install Playwright Browsers
        run: pnpm exec playwright install --with-deps chromium
      - name: Run E2E Tests
        run: pnpm test:e2e
```

This strategy guarantees that Hypernext is verified across every layer—from raw TCP bytes and background spam filtering to rendered browser DOM—ensuring true multi-protocol integrity.