# Supplementary Plan: Semantic Search, RAG, & AI Maintenance Engine

**Date:** 2026-07-16  
**Status:** Proposed Supplementary Architecture  
**Goal:** Provide an optional, opt-in AI subsystem for Hypernext. This includes semantic vector search (`sqlite-vector`), AI document summarization, a Retrieval-Augmented Generation (RAG) pipeline for MCP agents, and AI-assisted maintenance features (Alt Text generation, Auto-Tagging, SEO Meta descriptions, and Semantic Spam Moderation). To preserve the $5 VPS baseline, this feature requires zero local AI model weights; instead, it proxies to any user-configured OpenAI-compatible API (OpenAI, Ollama, LM Studio, vLLM). All processing is offloaded to the `workmatic` Worker Thread pool.

---

## 1. Core Architecture & Opt-In Tooling

Because AI models and vector processing can consume significant RAM and CPU, this entire subsystem is **disabled by default**. Users must explicitly enable it in `config.yml` and install the required dependencies.

*   **Vector Storage:** `sqlite-vector` (Stores mathematical representations of documents alongside standard SQLite tables).
*   **AI Client:** `openai` npm package (Used purely as a client; it can point to OpenAI's API, or a local Ollama/LM Studio instance by changing the `baseUrl`).
*   **Modular Models:** Users specify distinct models for different modalities (Embedding, Text/Utility, Vision, and Moderation) to support local AI setups where models are separate binaries.
*   **Background Processing:** All embedding generation, API calls, and vector operations are offloaded to the `workmatic` Worker Thread pool to prevent blocking the main HTTP/TCP event loop.

---

## 2. Configuration (`config.yml`)

The `ai` block configures the OpenAI-compatible endpoints and model selections.

```yaml
# config.yml
ai:
  enabled: false                  # Set to true to enable AI features
  openai:
    baseUrl: "http://localhost:11434/v1" # OpenAI, Ollama, LM Studio, etc.
    apiKey: ${OPENAI_API_KEY}     # Optional for local models like Ollama
  models:
    # 1. Used for semantic search (must match dimensions expected by sqlite-vector)
    embedding: "text-embedding-3-small" # or "nomic-embed-text" for Ollama
    
    # 2. Used for text tasks: RAG, summarization, SEO meta, auto-tagging
    utility: "gpt-4o-mini"        # or "llama3:8b" for Ollama
    
    # 3. Used for vision tasks: Alt text generation (requires a multimodal model)
    vision: "gpt-4o"              # or "llava:13b" for Ollama
    
    # 4. Used for complex moderation: Semantic spam analysis 
    # (Defaults to 'utility' if omitted, but allows specifying a reasoning model)
    moderation: "gpt-4o"          
    
  vectorDimensions: 1536          # Must match the output dimensions of the embedding model
  features:
    altText: true                 # Enable vision-based alt text generation
    autoTagging: true             # Enable smart taxonomy suggestions
    seoMeta: true                 # Auto-generate meta descriptions if missing
    moderation: true              # Use LLM to evaluate pending Akismet comments
```

---

## 3. Database Schema Updates (`@mikro-orm/sqlite`)

We add a virtual table for vector storage. The dimension size must match the configured embedding model (e.g., 1536 for OpenAI `text-embedding-3-small`, 768 for `nomic-embed-text`).

```sql
-- Requires loading the sqlite-vector extension
CREATE VIRTUAL TABLE IF NOT EXISTS docs_vec USING vec0(
  slug TEXT PRIMARY KEY,
  embedding FLOAT[1536] -- Matches config.ai.vectorDimensions
);
```

---

## 4. Indexing & Embedding Pipeline (`workmatic`)

When `ai.enabled` is true, the `workmatic` document processing job extends to generate embeddings.

1.  **Chunking:** The worker strips MDX components and frontmatter, splitting the plain text into chunks (e.g., 500 characters).
2.  **Embedding:** The worker sends the text to the configured OpenAI-compatible `embedding` endpoint.
3.  **Storage:** The returned vector array is upserted into the `docs_vec` table.

```typescript
// src/federation/ai-tasks.ts (Runs inside workmatic)
import OpenAI from 'openai';
import { getConfig } from '../config';
import { getDb } from '../database';

const config = getConfig().ai;
const client = new OpenAI({ baseURL: config.openai.baseUrl, apiKey: config.openai.apiKey });

export async function generateAndStoreEmbedding(slug: string, content: string) {
  const plainText = stripMdx(content);
  
  const response = await client.embeddings.create({
    model: config.models.embedding,
    input: plainText,
  });
  
  const embedding = response.data[0].embedding;
  
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO docs_vec (slug, embedding) VALUES (?, ?)
  `).run(slug, JSON.stringify(embedding));
}
```

---

## 5. API Endpoints (AI Summaries)

A new REST API endpoint allows fetching an AI-generated summary of any document. 

*   **Route:** `GET /api/v1/docs/:slug/summary`
*   **Auth:** If the document is `private`, requires `read` scope. If public, no auth required (unless globally locked down).
*   **Flow:** Fetches the document content -> Sends to utility model with a summarization prompt -> Returns the text.

```typescript
// src/api/ai.ts
import { FastifyInstance } from 'fastify';
import { getDb } from '../database';
import { storage } from '../storage';
import { workmatic } from 'workmatic';
import { generateSummary } from '../federation/ai-tasks';

export default async function aiRoutes(app: FastifyInstance) {
  app.get('/api/v1/docs/:slug/summary', async (req, reply) => {
    const { slug } = req.params as any;
    const db = getDb();
    const meta = db.prepare('SELECT visibility FROM docs_meta WHERE slug = ?').get(slug);
    
    if (!meta) return reply.code(404).send({ error: 'Not found' });

    const content = await storage.read(`${slug}.mdx`);
    const plainText = stripMdx(content);
    
    try {
      const summary = await workmatic.execute(generateSummary, plainText);
      return { data: { slug, summary } };
    } catch (error) {
      return reply.code(503).send({ error: 'AI service unavailable' });
    }
  });
}
```

---

## 6. MCP Agent Access ("Talk with your documents")

This feature exposes a `talk_to_docs` tool that implements a full Retrieval-Augmented Generation (RAG) pipeline. 

When an agent asks a question, Hypernext:
1. Embeds the question.
2. Performs a K-Nearest Neighbors (KNN) search on `sqlite-vector`.
3. Fetches the top 3 matching document contents.
4. Sends the question and the document contexts to the `utility` model.
5. Returns the generated, context-aware answer to the agent.

### Implementation
```typescript
// src/mcp/index.ts
import { Server } from '@modelcontextprotocol/sdk/server';
import { workmatic } from 'workmatic';
import { ragSearch } from '../federation/ai-tasks';

const server = new Server();

server.setRequestHandler('tools/list', async () => ({
  tools: [
    // ... other tools ...
    { 
      name: 'talk_to_docs', 
      description: 'Ask a natural language question and get an answer based on the content of your documents.', 
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } } 
    }
  ]
}));

server.setRequestHandler('tools/call', async (req) => {
  if (req.params.name === 'talk_to_docs') {
    const query = req.params.arguments.query;
    const answer = await workmatic.execute(ragSearch, query);
    return { content: [{ type: 'text', text: answer }] };
  }
});
```

### RAG Pipeline (`src/federation/ai-tasks.ts`)
```typescript
export async function ragSearch(query: string): Promise<string> {
  // 1. Embed the user's query
  const queryResponse = await client.embeddings.create({
    model: config.models.embedding,
    input: query,
  });
  const queryVector = queryResponse.data[0].embedding;

  // 2. Semantic Search in sqlite-vector (KNN)
  const db = getDb();
  const matches = db.prepare(`
    SELECT slug, distance 
    FROM docs_vec 
    WHERE embedding MATCH ? 
    ORDER BY distance 
    LIMIT 3
  `).all(JSON.stringify(queryVector));

  // 3. Fetch document content
  const contexts = [];
  for (const match of matches) {
    const content = await storage.read(`${match.slug}.mdx`);
    contexts.push(`Document: ${match.slug}\nContent: ${stripMdx(content).substring(0, 1500)}`);
  }

  // 4. Generate Answer via Utility Model
  const prompt = `
    Use the following documents to answer the user's question. 
    If the answer is not in the documents, say "I couldn't find this information in the documents."
    
    Context Documents:
    ${contexts.join('\n\n---\n\n')}
    
    User Question: ${query}
  `;

  const response = await client.chat.completions.create({
    model: config.models.utility,
    messages: [
      { role: "system", content: "You are a helpful assistant answering questions based strictly on the provided context." },
      { role: "user", content: prompt }
    ],
  });

  return response.choices[0].message.content;
}
```

---

## 7. AI Maintenance Features

These features assist with site maintenance, accessibility, and organization without crossing the line into auto-generating the actual post content. All functions run inside `workmatic`.

### A. Vision-Powered Alt Text Generation
When a user uploads an image, the system uses the `vision` model to analyze the image and suggest descriptive alt text.
*   **TUI Integration:** A pop-up appears: "Generate Alt Text? [Y/n]". If yes, the text is inserted into the `alt="..."` prop.

### B. Smart Taxonomy Auto-Tagging
When a document is saved, the AI analyzes the text and suggests tags based *only* on the user's pre-existing taxonomy in SQLite. If no existing tags fit, it can propose a new, kebab-cased tag.
*   **Frontmatter Form Integration:** In the TUI Frontmatter Form, the user can press `Ctrl+G` to auto-fill the Tags input field with AI suggestions.

### C. Automated SEO Meta Descriptions
If the `description` field is left blank in the frontmatter, the `workmatic` indexer automatically generates a concise, SEO-optimized summary using the `utility` model and caches it in SQLite. The HTML renderer uses this for the `<head>` meta tags and Open Graph tags.

### D. LLM-Enhanced Spam Moderation
When a Webmention or Trackback comes in and Akismet returns `PENDING` (unsure), Hypernext passes the comment to the `moderation` model with a strict prompt: *"Analyze this comment. Does it add contextual value to the post, or is it generic semantic spam? Reply ONLY with 'HAM' or 'SPAM'."*
*   **TUI Moderation Queue:** If the AI flags it as spam, it moves to the Spam queue. If HAM, it moves to Approved.

### Implementation (`src/federation/ai-tasks.ts`)

```typescript
// 1. Vision Task: Alt Text Generation
export async function generateAltText(imageBuffer: Buffer, mimeType: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: config.models.vision, // Explicitly use the vision model
    messages: [
      { role: "user", content: [
        { type: "text", text: "Write a concise, descriptive alt text for this image for accessibility. Output only the text." },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } }
      ]}
    ],
  });
  return response.choices[0].message.content;
}

// 2. Text Task: Auto-Tagging
export async function suggestTags(content: string, existingTags: string[]): Promise<string[]> {
  const response = await client.chat.completions.create({
    model: config.models.utility, // Explicitly use the text utility model
    messages: [{ role: "user", content: `Suggest tags for this text. Existing tags: ${existingTags.join(', ')}. Text: ${content.substring(0, 2000)}` }],
  });
  return parseTagsFromResponse(response.choices[0].message.content);
}

// 3. Text Task: SEO Meta Description
export async function generateSeoMeta(content: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: config.models.utility,
    messages: [{ role: "user", content: `Write a compelling 155-character SEO meta description for this text: ${content.substring(0, 2000)}` }],
  });
  return response.choices[0].message.content;
}

// 4. Moderation Task: Semantic Spam Analysis
export async function aiModerateComment(comment: string, postContent: string): Promise<'ham' | 'spam'> {
  const response = await client.chat.completions.create({
    // Use the dedicated moderation model, or fall back to utility if not specified
    model: config.models.moderation || config.models.utility, 
    messages: [{ role: "user", content: `Is this comment spam? Comment: ${comment}` }],
  });
  return response.choices[0].message.content.toLowerCase().includes('ham') ? 'ham' : 'spam';
}

// 5. Text Task: Document Summarization
export async function generateSummary(text: string): Promise<string> {
  const truncated = text.substring(0, 4000);
  const response = await client.chat.completions.create({
    model: config.models.utility,
    messages: [
      { role: "system", content: "You are a helpful assistant. Summarize the following document in 3 concise bullet points." },
      { role: "user", content: truncated }
    ],
    temperature: 0.3,
  });
  return response.choices[0].message.content;
}
```

---

## 8. TUI Integration

The TUI Editor gains local interaction capabilities for these AI features.

*   **Command:** `> Talk to Docs`: A modal overlay with a `TextInput`. The user types a question, hits `Enter`, and the TUI streams the response from the local `workmatic` RAG pipeline to the screen.
*   **Frontmatter Form:** In the Tags input, press `Ctrl+G` to fetch AI tag suggestions.
*   **Media Browser:** When inserting an image, press `A` to auto-generate Alt Text using the vision model.

---

## 9. Dependencies (Opt-In)

Users must install `openai` and `sqlite-vector` manually or via a CLI setup flag (`hypernext setup ai`).

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
    "lru-cache": "^10.x",
    "md-to-pdf": "^5.x",
    "md-to-epub": "^1.x",
    "openai": "^4.x",           // OpenAI-compatible API client
    "sqlite-vector": "^0.1.x",  // SQLite vector extension
    "remark": "^15.x",
    "remark-mdx": "^3.x",
    "remark-math": "^6.x",
    "remark-parse": "^11.x",
    "turndown": "^7.x",
    "yaml": "^2.x"
  }
}
```

### Summary of AI Architecture:
1.  **Flexible:** Works with OpenAI, Anthropic (via proxy), or 100% locally/offline using Ollama or LM Studio.
2.  **Modular:** Distinct models can be configured for embedding, text, vision, and moderation to support local AI resource constraints.
3.  **Lean:** Does not bundle gigabytes of model weights. Uses standard HTTP API calls.
4.  **Non-Blocking:** All embedding and LLM calls happen inside `workmatic` worker threads. The main Fastify/TCP servers remain highly responsive.
5.  **Agent-Ready:** The `talk_to_docs` MCP tool turns Hypernext into a private, semantic knowledge base for AI agents.