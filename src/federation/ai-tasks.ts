import OpenAI from "openai";
import type { AiConfig, HypernextConfig } from "../types/config.js";

const FRONTMATTER_REGEX = /^---[\s\S]*?---\n?/;
const JSX_TAG_REGEX = /<[A-Z][a-zA-Z]*\s*\/?>/g;
const JSX_CLOSE_REGEX = /<\/[A-Z][a-zA-Z]*>/g;
const TAG_SPLIT_REGEX = /[,;\n]+/;
const WHITESPACE_REGEX = /\s+/g;

let client: OpenAI | null = null;

function getAiConfig(config: HypernextConfig): AiConfig {
  if (!config.ai) {
    throw new Error("AI is not enabled");
  }
  return config.ai;
}

function getClient(ai: AiConfig): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: ai.openai.baseUrl,
      apiKey: ai.openai.apiKey ?? undefined,
    });
  }
  return client;
}

function stripMdx(content: string): string {
  const withoutFrontmatter = content.replace(FRONTMATTER_REGEX, "");
  return withoutFrontmatter
    .replace(JSX_TAG_REGEX, "")
    .replace(JSX_CLOSE_REGEX, "")
    .trim();
}

// ── Embedding ──

export async function generateAndStoreEmbedding(
  config: HypernextConfig,
  slug: string,
  content: string
): Promise<void> {
  const ai = getAiConfig(config);
  const plainText = stripMdx(content);

  const response = await getClient(ai).embeddings.create({
    model: ai.models.embedding,
    input: plainText,
  });

  const embedding = response.data[0].embedding;

  const { getEm } = await import("../database/index.js");
  const em = getEm();
  await em
    .getConnection()
    .execute(
      "INSERT OR REPLACE INTO docs_vec (slug, embedding) VALUES (?, ?)",
      [slug, JSON.stringify(embedding)]
    );
}

// ── Summarization ──

export async function generateSummary(
  config: HypernextConfig,
  text: string
): Promise<string> {
  const ai = getAiConfig(config);
  const truncated = text.slice(0, 4000);
  const response = await getClient(ai).chat.completions.create({
    model: ai.models.utility,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant. Summarize the following document in 3 concise bullet points.",
      },
      { role: "user", content: truncated },
    ],
    temperature: 0.3,
  });
  return response.choices[0].message.content ?? "";
}

// ── Alt Text Generation ──

export async function generateAltText(
  config: HypernextConfig,
  imageBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const ai = getAiConfig(config);
  const model = ai.models.vision ?? ai.models.utility;
  const response = await getClient(ai).chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Write a concise, descriptive alt text for this image for accessibility. Output only the text.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
            },
          },
        ],
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// ── Auto-Tagging ──

export async function suggestTags(
  config: HypernextConfig,
  content: string,
  existingTags: string[]
): Promise<string[]> {
  const ai = getAiConfig(config);
  const response = await getClient(ai).chat.completions.create({
    model: ai.models.utility,
    messages: [
      {
        role: "user",
        content: `Suggest tags for this text. Existing tags: ${existingTags.join(", ")}. Text: ${content.slice(0, 2000)}`,
      },
    ],
  });
  const text = response.choices[0].message.content ?? "";
  return text
    .split(TAG_SPLIT_REGEX)
    .map((t) => t.trim().toLowerCase().replace(WHITESPACE_REGEX, "-"))
    .filter((t) => t.length > 0);
}

// ── SEO Meta Description ──

export async function generateSeoMeta(
  config: HypernextConfig,
  content: string
): Promise<string> {
  const ai = getAiConfig(config);
  const response = await getClient(ai).chat.completions.create({
    model: ai.models.utility,
    messages: [
      {
        role: "user",
        content: `Write a compelling 155-character SEO meta description for this text: ${content.slice(0, 2000)}`,
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}

// ── Semantic Spam Moderation ──

export async function aiModerateComment(
  config: HypernextConfig,
  comment: string,
  postContent: string
): Promise<"ham" | "spam"> {
  const ai = getAiConfig(config);
  const model = ai.models.moderation ?? ai.models.utility;
  const response = await getClient(ai).chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: `Analyze this comment. Does it add contextual value to the post, or is it generic semantic spam? Reply ONLY with 'HAM' or 'SPAM'.\n\nPost: ${postContent.slice(0, 1000)}\n\nComment: ${comment}`,
      },
    ],
  });
  const text = (response.choices[0].message.content ?? "").toLowerCase();
  return text.includes("ham") ? "ham" : "spam";
}

// ── RAG Search ──

export async function ragSearch(
  config: HypernextConfig,
  query: string
): Promise<string> {
  const ai = getAiConfig(config);

  // 1. Embed the query
  const queryResponse = await getClient(ai).embeddings.create({
    model: ai.models.embedding,
    input: query,
  });
  const queryVector = queryResponse.data[0].embedding;

  // 2. KNN search
  const { getEm } = await import("../database/index.js");
  const em = getEm();
  const matches = await em.getConnection().execute<{
    slug: string;
    distance: number;
  }>(
    "SELECT slug, distance FROM docs_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 3",
    [JSON.stringify(queryVector)]
  );

  // 3. Fetch document content
  const { getDocBySlug } = await import("../database/index.js");
  const contexts: string[] = [];
  for (const match of matches) {
    const doc = await getDocBySlug(match.slug);
    if (doc) {
      const content = stripMdx((doc.rawMdx as string) ?? "");
      contexts.push(
        `Document: ${match.slug}\nContent: ${content.slice(0, 1500)}`
      );
    }
  }

  if (contexts.length === 0) {
    return "I couldn't find any relevant documents to answer your question.";
  }

  // 4. Generate answer
  const response = await getClient(ai).chat.completions.create({
    model: ai.models.utility,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant answering questions based strictly on the provided context.",
      },
      {
        role: "user",
        content: `Use the following documents to answer the user's question. If the answer is not in the documents, say "I couldn't find this information in the documents."\n\nContext Documents:\n${contexts.join("\n\n---\n\n")}\n\nUser Question: ${query}`,
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}
