/**
 * Piscina worker entry point.
 * Each exported function handles a specific job type.
 * Workers run in a separate thread and cannot access the main thread's
 * module state directly. They re-initialize ORM connections as needed.
 */
import { processInboundMention } from "./inbound-mentions.js";
import { processIndexing } from "./indexing.js";
import { processOutboundSyndication } from "./outbound-syndication.js";
import { processPosseReplies } from "./posse-replies.js";
import { processAiEmbedding } from "./ai-embedding.js";
import { processAiText } from "./ai-text.js";
import { processIpfsPinning } from "./ipfs-pinning.js";
import { processPdfGeneration } from "./pdf-generation.js";
import { processEpubGeneration } from "./epub-generation.js";
import { processEmailVerification } from "./email-verification.js";
import { processEmailSend } from "./email-send.js";
import { processEmailDigest } from "./email-digest.js";

interface JobPayload {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export default async function processJob(job: JobPayload): Promise<unknown> {
  switch (job.type) {
    case "inbound-mentions":
      return processInboundMention(job.payload);
    case "indexing":
      return processIndexing(job.payload);
    case "outbound-syndication":
      return processOutboundSyndication(job.payload);
    case "posse-replies":
      return processPosseReplies(job.payload);
    case "ai-embedding":
      return processAiEmbedding(job.payload);
    case "ai-text":
      return processAiText(job.payload);
    case "ipfs-pinning":
      return processIpfsPinning(job.payload);
    case "pdf-generation":
      return processPdfGeneration(job.payload);
    case "epub-generation":
      return processEpubGeneration(job.payload);
    case "email-verification":
      return processEmailVerification(job.payload);
    case "email-send":
      return processEmailSend(job.payload);
    case "email-digest":
      return processEmailDigest(job.payload);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}
