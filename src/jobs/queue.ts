import { randomUUID } from "node:crypto";
import { getEm } from "../database/index.js";

// ── Types ──

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobRecord {
  attempts: number;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
  id: string;
  maxAttempts: number;
  payload: string;
  result: string | null;
  scheduledAt: string;
  startedAt: string | null;
  status: JobStatus;
  type: string;
}

export interface JobOptions {
  idempotencyKey?: string;
  maxAttempts?: number;
  scheduledAt?: Date;
}

// ── Schema DDL ──

export const JOBS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_at);`;

// ── Queue Operations ──

export async function schedule(
  type: string,
  payload: Record<string, unknown>,
  opts: JobOptions = {}
): Promise<string> {
  const em = getEm();
  const id = randomUUID();
  const idempotencyKey = opts.idempotencyKey;

  if (idempotencyKey) {
    const existing = await em
      .getConnection()
      .execute<{ id: string }[]>("SELECT id FROM jobs WHERE id = ?", [
        idempotencyKey,
      ]);
    if (existing.length > 0) {
      return existing[0]?.id ?? idempotencyKey;
    }
  }

  const now = new Date().toISOString();
  const scheduledAt = opts.scheduledAt ? opts.scheduledAt.toISOString() : now;

  await em.getConnection().execute(
    `INSERT INTO jobs (id, type, payload, status, max_attempts, scheduled_at, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    [
      idempotencyKey ?? id,
      type,
      JSON.stringify(payload),
      opts.maxAttempts ?? 3,
      scheduledAt,
      now,
    ]
  );

  return idempotencyKey ?? id;
}

export async function claimNext(types?: string[]): Promise<JobRecord | null> {
  const em = getEm();
  const typeFilter =
    types && types.length > 0
      ? ` AND type IN (${types.map(() => "?").join(",")})`
      : "";
  const now = new Date().toISOString();

  const rows = await em.getConnection().execute<JobRecord[]>(
    `UPDATE jobs SET
       status = 'running',
       attempts = attempts + 1,
       started_at = ?
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'pending'
         AND scheduled_at <= ?
         ${typeFilter}
       ORDER BY scheduled_at ASC
       LIMIT 1
     )
     RETURNING *`,
    [now, now]
  );

  return rows.length > 0 ? (rows[0] ?? null) : null;
}

export async function markComplete(
  id: string,
  result?: Record<string, unknown>
): Promise<void> {
  const em = getEm();
  await em.getConnection().execute(
    `UPDATE jobs SET status = 'completed', completed_at = ?, result = ?
     WHERE id = ?`,
    [new Date().toISOString(), result ? JSON.stringify(result) : null, id]
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  const em = getEm();
  await em.getConnection().execute(
    `UPDATE jobs SET status = 'failed', completed_at = ?, error = ?
     WHERE id = ?`,
    [new Date().toISOString(), error, id]
  );
}

export async function markRetry(
  id: string,
  nextAttemptAt: Date
): Promise<void> {
  const em = getEm();
  await em.getConnection().execute(
    `UPDATE jobs SET status = 'pending', scheduled_at = ?
     WHERE id = ?`,
    [nextAttemptAt.toISOString(), id]
  );
}

export function listJobs(filter?: {
  type?: string;
  status?: JobStatus;
  limit?: number;
  offset?: number;
}): Promise<JobRecord[]> {
  const em = getEm();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.type) {
    conditions.push("type = ?");
    params.push(filter.type);
  }
  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 50;
  const offset = filter?.offset ?? 0;

  return em
    .getConnection()
    .execute<JobRecord[]>(
      `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
}

export async function recoverOrphanedJobs(
  timeoutMs = 300_000
): Promise<number> {
  const em = getEm();
  const cutoff = new Date(Date.now() - timeoutMs).toISOString();
  const result = await em.getConnection().execute<{ changes: number }>(
    `UPDATE jobs SET status = 'pending', started_at = NULL
     WHERE status = 'running' AND started_at <= ?`,
    [cutoff]
  );
  return result.changes;
}

export async function initJobsTable(): Promise<void> {
  const em = getEm();
  await em.getConnection().executeDump(JOBS_TABLE_SQL);
}
