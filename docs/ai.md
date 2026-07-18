# AI Features

Hypernext integrates with OpenAI-compatible APIs for AI-powered content features.

## Configuration

```yaml
ai:
  enabled: true
  openai:
    baseUrl: "http://localhost:11434/v1"
    apiKey: ""
  models:
    embedding: "nomic-embed-text-v2-moe:latest"
    utility: "llama3.2:1b"
    vision: "llava:7b"
    reasoning: "llama3.1:8b"
  vectorDimensions: 768
  features:
    altText: true
    autoTagging: true
    seoMeta: true
    moderation: true
```

The default configuration points at a local Ollama instance. For OpenAI, set `baseUrl` to `https://api.openai.com/v1` and provide an API key.

## Features

### Semantic Search (RAG)

When AI is enabled, documents are embedded into a `docs_vec` vector table using `vec0`. The `talk_to_docs` MCP tool performs RAG search:

1. Embeds the user's query
2. Performs KNN search against document embeddings
3. Generates a natural language answer using the utility model

### Auto Alt Text

Generates descriptive alt text for images using the vision model.

### Auto Tagging

Suggests tags for new documents based on content analysis.

### SEO Meta

Generates SEO-optimized meta descriptions.

### Content Moderation

Analyzes comments for semantic spam using the utility model.

## Vector Search

The vector table is initialized on startup when AI is enabled:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(
  slug TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

## MCP Tool

```
talk_to_docs(query)
```

Ask a natural language question and get an answer based on document content.
