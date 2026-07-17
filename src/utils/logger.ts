import type { HypernextConfig, LoggingConfig } from "../types/config.js";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
};

interface LogEntry {
  _meta: { minLevel: number; name: string };
  level: string;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

type Transport = (entry: LogEntry) => void;

const transports: Transport[] = [];
let minLevel = 3;
let maskSecrets = false;
let format: "json" | "pretty" = "pretty";

const SECRET_MASK_RE =
  /"(password|token|apiKey|secretAccessKey|authorization)":"[^"]*"/gi;

function maskSensitive(text: string): string {
  if (!maskSecrets) {
    return text;
  }
  return text.replace(SECRET_MASK_RE, (match) => {
    const eqIdx = match.indexOf(":");
    return `${match.slice(0, eqIdx + 1)}"***"`;
  });
}

function createEntry(
  level: LogLevel,
  msg: string,
  meta?: Record<string, unknown>
): LogEntry {
  return {
    ...meta,
    _meta: { minLevel: LEVEL_NUM[level], name: level.toUpperCase() },
    level,
    msg: maskSensitive(msg),
    timestamp: new Date().toISOString(),
  };
}

function formatPretty(entry: LogEntry): string {
  const label = entry.level.toUpperCase().padEnd(5);
  return `[${entry.timestamp.slice(0, 19).replace("T", " ")}] [${label}] ${entry.msg}`;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function emit(entry: LogEntry): void {
  if (LEVEL_NUM[entry.level as LogLevel] < minLevel) {
    return;
  }
  const output = format === "json" ? formatJson(entry) : formatPretty(entry);
  if (LEVEL_NUM[entry.level as LogLevel] >= 4) {
    console.error(output);
  } else {
    console.log(output);
  }
  for (const t of transports) {
    t(entry);
  }
}

export function initLogger(config: HypernextConfig): void {
  const logCfg: LoggingConfig = config.logging ?? {
    level: "info",
    format: "pretty",
    logToFile: false,
    maskSecrets: true,
  };
  minLevel = LEVEL_NUM[logCfg.level] ?? 3;
  format = logCfg.format;
  maskSecrets = logCfg.maskSecrets;

  if (logCfg.logToFile && logCfg.filePath) {
    const filePath = logCfg.filePath;
    import("node:fs").then((fs) => {
      transports.push((entry) => {
        const line = `${formatJson(entry)}\n`;
        try {
          fs.appendFileSync(filePath, line);
        } catch {
          // Silently fail — don't crash on log write errors
        }
      });
    });
  }
}

export function attachTransport(t: Transport): void {
  transports.push(t);
}

export const logger = {
  trace(msg: string, meta?: Record<string, unknown>) {
    emit(createEntry("trace", msg, meta));
  },
  debug(msg: string, meta?: Record<string, unknown>) {
    emit(createEntry("debug", msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>) {
    emit(createEntry("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    emit(createEntry("warn", msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    emit(createEntry("error", msg, meta));
  },
};
