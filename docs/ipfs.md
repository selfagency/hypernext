# IPFS Integration

Hypernext can pin document content and rendered HTML to IPFS, providing content-addressed, decentralized access to your site.

## Configuration

```yaml
ipfs:
  enabled: true
  apiEndpoint: "http://127.0.0.1:5001"
  gatewayUrl: "https://ipfs.io/ipfs"
  pinning: true
  cacheHtml: true
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable IPFS integration |
| `apiEndpoint` | `http://127.0.0.1:5001` | Kubo RPC API endpoint |
| `gatewayUrl` | `https://ipfs.io/ipfs` | Public gateway URL for links |
| `pinning` | `true` | Pin content to local IPFS node |
| `cacheHtml` | `true` | Also pin rendered HTML version |

## Storage Provider

Set `storage.type: ipfs` to use IPFS as the primary storage backend. Content is stored as IPFS CIDs in the database rather than on the filesystem.

## Auto-Pinning

When IPFS is enabled, the indexing queue automatically enqueues each document for pinning. The `ipfs-pinning` workmatic queue handles content + optional HTML caching.

## API Endpoints

### Get Document CIDs

```
GET /api/v1/docs/:slug/ipfs
```

Returns the content CID and HTML CID for a document.

### Pin Document

```
POST /api/v1/docs/:slug/pin
```

Triggers immediate pinning of a document to IPFS.

## MDX Component

```mdx
<IPFSLink />
```

Renders a "View on IPFS" link using the configured gateway URL. Falls back from HTML CID to content CID.

## MCP Tools

- `get_doc_cid` — Get IPFS CIDs for a document
- `pin_doc` — Pin a document to IPFS

## TUI Commands

- `Ctrl+I` — Copy IPFS gateway URL for the current document
- Command palette: "Pin to IPFS", "Copy IPFS Gateway URL"

## HTML Meta Tags

When CIDs are available, the HTML renderer includes:

```html
<meta name="ipfs-cid" content="..." />
<meta name="ipfs-html-cid" content="..." />
```
