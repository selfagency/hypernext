Implementing IPFS into Hypernext is a fantastic idea, as it aligns perfectly with the IndieWeb ethos of ownership, permanence, and decentralization. 

However, because Hypernext is strictly designed for a **$5 VPS (512MB-1GB RAM)**, we **cannot** run a full embedded IPFS node (like `js-ipfs` or `helia`) inside the main Node.js process. Doing so would immediately crash the server due to memory exhaustion.

Instead, the best approach is a **Lightweight Client & Gateway Architecture**. Hypernext acts as an orchestrator, using the `kubo-rpc-client` library to talk to an external IPFS HTTP API (either a local Kubo daemon, a remote node, or a pinning service like Pinata/web3.storage). 

Here is the supplementary plan for integrating IPFS as a distributed storage layer and HTML cache.

## Overriding Decisions

| Area | Original Plan | Actual Implementation | See |
|------|--------------|---------------------|-----|
| Storage type | `storage.type: "ipfs"` as option | Removed — IPFS is always additive; `storage.type` is `local` or `s3` | REMEDIATION-PLAN.md §P2-27 |
| Job architecture | Workmatic for IPFS pinning | SQLite-persisted queue + piscina | REMEDIATION-PLAN.md §P1-1 |

---

# Supplementary Plan: IPFS Integration (Distributed Storage & Cached HTML)

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Integrate IPFS for decentralized document storage and immutable HTML caching. Hypernext will act as an IPFS orchestrator, communicating with an external IPFS node or pinning service via HTTP RPC, keeping the $5 VPS memory footprint minimal.

---

## 1. Core Architecture & Constraints

*   **No Embedded Node:** Hypernext uses `kubo-rpc-client` to talk to an IPFS node's HTTP API (default: `http://127.0.0.1:5001`). This means the user can run Kubo as a separate systemd service on the same VPS, or Hypernext can point to a remote node/pinning service.
*   **Content Addressing:** Every MDX document and rendered HTML page gets a CID (Content Identifier).
*   **Workmatic Offloading:** All IPFS network operations (pinning, fetching) are offloaded to the `workmatic` Worker Thread pool to prevent blocking the main event loop.

### Configuration (`config.yml`)
```yaml
# config.yml
ipfs:
  enabled: true
  apiEndpoint: "http://127.0.0.1:5001"  # Kubo RPC API
  gatewayUrl: "https://ipfs.io/ipfs"    # Public gateway for serving to clients
  pinning: true                          # Pin content locally to the node
  cacheHtml: true                        # Pin rendered HTML pages to IPFS
```

---

## 2. IPFS as Document Storage (The `IPFSStorageProvider`)

Hypernext's storage layer is pluggable. By setting `storage.type: ipfs`, the system uses the IPFS network for canonical MDX file storage.

### Write Flow (New/Updated Post)
1. The API or TUI submits an MDX file.
2. The `workmatic` worker receives the file content as a buffer.
3. It uses `kubo-rpc-client`'s `add` method to upload the buffer to the IPFS node.
4. The worker receives the CID (e.g., `bafy...`).
5. The worker stores the CID in the SQLite `docs_meta` table under the `content_cid` column.
6. The worker issues a `pin add` command to ensure the node retains the file.

### Read Flow (Requesting a Post)
1. The server checks SQLite for the `content_cid`.
2. If using IPFS storage, the worker fetches the content via `kubo-rpc-client`'s `cat` method.
3. The content is passed to the parser pipeline.

```typescript
// src/storage/ipfs-provider.ts
import { create } from 'kubo-rpc-client';
import { getConfig } from '../config';

const config = getConfig().ipfs;
const ipfs = create({ url: config.apiEndpoint });

export async function writeDoc(slug: string, content: Buffer): Promise<string> {
  const { cid } = await ipfs.add(content);
  if (config.pinning) {
    await ipfs.pin.add(cid);
  }
  return cid.toString();
}

export async function readDoc(cid: string): Promise<string> {
  const chunks = [];
  for await (const chunk of ipfs.cat(cid)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
```

---

## 3. IPFS as HTML Cache (Immutable Distribution)

To leverage IPFS for serving cached HTML pages, Hypernext pins the fully rendered HTML output to IPFS. This allows users to view your content via public IPFS gateways even if your $5 VPS goes offline.

### Caching Pipeline (in `workmatic`)
1. After the indexer parses the MDX into an IR and renders the final HTML string, it checks if `ipfs.cacheHtml` is true.
2. If true, the worker uploads the HTML string to IPFS.
3. The resulting CID is stored in a new SQLite column: `html_cid`.

### Serving via Gateway
When a user requests a page via HTTP, Hypernext injects a special header or `<meta>` tag:
`<meta name="ipfs-cid" content="bafy...">`
Furthermore, the API exposes the CID:
```json
{
  "slug": "/blog/welcome",
  "html_cid": "bafyreiab3..."
}
```
Users can then access the immutable, cached version of the page at `https://ipfs.io/ipfs/bafyreiab3...`.

---

## 4. Database Schema Updates

We add two new columns to the `docs_meta` table to track the CIDs.

```sql
ALTER TABLE docs_meta ADD COLUMN content_cid TEXT;
ALTER TABLE docs_meta ADD COLUMN html_cid TEXT;
```

If using MikroORM entities:
```typescript
// src/database/entities/DocMeta.ts
export class DocMeta {
  // ... existing fields ...
  
  @Property({ nullable: true })
  content_cid: string; // IPFS CID of the raw MDX file

  @Property({ nullable: true })
  html_cid: string; // IPFS CID of the rendered HTML cache
}
```

---

## 5. MDX Component & UI Integration

To expose the IPFS capabilities to the frontend, we add a component and API endpoints.

### `<IPFSLink />` Component
Allows authors to display a link to the IPFS canonical version of the document.

| Component | Description | HTML Rendering | Gemini/Gopher Rendering |
| :--- | :--- | :--- | :--- |
| `<IPFSLink />` | Link to IPFS gateway | `<a href="https://ipfs.io/ipfs/{cid}">View on IPFS</a>` | `=> https://ipfs.io/ipfs/{cid} View on IPFS` |

### REST API Endpoints
*   `GET /api/v1/docs/:slug/ipfs`: Returns `{ content_cid, html_cid }`.
*   `POST /api/v1/docs/:slug/pin`: Manually triggers the `workmatic` worker to re-pin the content and HTML to the IPFS node.

---

## 6. TUI & MCP Integration

### TUI Editor
In the Left Pane file browser, files stored on IPFS display a `` icon (if Nerd Fonts are enabled) next to their name.
*   **Hotkey:** `Ctrl+I` copies the IPFS gateway URL of the current document to the clipboard.
*   **Command Palette:** `> Pin to IPFS` manually triggers a pin operation for the open file.

### MCP Agent Access
Agents can interact with the IPFS layer programmatically.
*   `get_doc_cid(slug)`: Returns the IPFS CIDs for a document.
*   `pin_doc(slug)`: Ensures the document and its HTML cache are pinned to the configured IPFS node.

---

## 7. Dependencies

Add `kubo-rpc-client` to the production dependencies.

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "@atproto/api": "^0.x",
    "@upyo/core": "^0.x",
    "@upyo/smtp": "^0.x",
    "node-email-verifier": "^1.x",
    "ribaunt": "^1.x",
    "asciify-engine": "^1.x",
    "better-sqlite3": "^11.x",
    "cac": "^6.x",
    "fastify": "^4.x",
    "gray-matter": "^4.x",
    "katex": "^0.16.x",
    "kubo-rpc-client": "^4.x",      // NEW: IPFS HTTP API Client
    "lru-cache": "^10.x",
    "md-to-pdf": "^5.x",
    "md-to-epub": "^1.x",
    "remark": "^15.x",
    "remark-mdx": "^3.x",
    "remark-math": "^6.x",
    "remark-parse": "^11.x",
    "turndown": "^7.x",
    "yaml": "^2.x"
  }
}
```

### Why this approach is optimal for Hypernext:
1. **Preserves $5 VPS Constraint:** By using `kubo-rpc-client` to talk to an external HTTP API, Hypernext doesn't carry the 500MB+ memory weight of a full IPFS node in its own process.
2. **True Decentralization:** Authors aren't just hosting on a traditional VPS; their content is permanently pinned to IPFS and accessible via public gateways.
3. **Immutable Backups:** The `content_cid` serves as a cryptographic guarantee that the file hasn't been tampered with. If S3 or Local FS fails, Hypernext can automatically restore the MDX content directly from the IPFS network.