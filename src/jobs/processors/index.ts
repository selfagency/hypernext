/**
 * Piscina worker entry point.
 * Each exported function handles a specific job type.
 * Workers run in a separate thread and cannot access the main thread's
 * module state directly. They re-initialize ORM connections as needed.
 */

import { processAiEmbedding } from "./ai-embedding.js";
import { processAiText } from "./ai-text.js";
import { processEmailDigest } from "./email-digest.js";
import { processEmailSend } from "./email-send.js";
import { processEmailVerification } from "./email-verification.js";
import { processInboundMention } from "./inbound-mentions.js";
import { processIndexing } from "./indexing.js";
import { processIpfsPinning } from "./ipfs-pinning.js";
import { processOutboundSyndication } from "./outbound-syndication.js";
import { processPosseReplies } from "./posse-replies.js";

interface JobPayload {
  id: string;
  payload: Record<string, unknown>;
  type: string;
}

const HANDLERS: Record<
  string,
  (payload: Record<string, unknown>) => Promise<unknown>
> = {
  "inbound-mentions": processInboundMention,
  indexing: processIndexing,
  "outbound-syndication": processOutboundSyndication,
  "posse-replies": processPosseReplies,
  "ai-embedding": processAiEmbedding,
  "ai-text": processAiText,
  "ipfs-pinning": processIpfsPinning,
  "email-verification": processEmailVerification,
  "email-send": processEmailSend,
  "email-digest": processEmailDigest,
};

export default function processJob(job: JobPayload): Promise<unknown> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    throw new Error(`Unknown job type: ${job.type}`);
  }
  return handler(job.payload);
}
