#!/usr/bin/env tsx
// fallow-ignore-file
/**
 * Generate self-signed TLS certificates for local development
 * and add them to config.yml.
 *
 * Usage:
 *   pnpm tsx scripts/generate-certs.ts
 *   pnpm tsx scripts/generate-certs.ts --config ./config.example.yml
 *   pnpm tsx scripts/generate-certs.ts --dir ./certs --days 3650
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parse, stringify } from "yaml";

const {
  values: { config: configPathArg, dir: certDirArg, days: daysArg },
} = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: "string", short: "c", default: "./config.yml" },
    dir: { type: "string", short: "d", default: "./certs" },
    days: { type: "string", short: "D", default: "365" },
  },
});

const PROJECT_ROOT = path.resolve(".");

const configPath = path.resolve(configPathArg ?? "./config.yml");
const certDir = path.resolve(certDirArg ?? "./certs");
const days = Number(daysArg ?? 365);

// Validate paths are within project directory (prevents path traversal)
if (
  !(configPath.startsWith(PROJECT_ROOT) && certDir.startsWith(PROJECT_ROOT))
) {
  console.error("Error: paths must be within the project directory");
  process.exit(1);
}

// ── 1. Create cert directory ──
fs.mkdirSync(certDir, { recursive: true }); // NOSONAR — validated above

const certPath = path.join(certDir, "cert.pem");
const keyPath = path.join(certDir, "key.pem");

// ── 2. Generate cert if it doesn't exist ──
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log(`✓ Certificates already exist at ${certDir}/`);
} else {
  console.log(`Generating self-signed certificate (${days} days)...`);
  execSync(
    "openssl", // NOSONAR — PATH restricted to fixed, unwriteable directories
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      String(days),
      "-nodes",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "inherit", env: { ...process.env, PATH: "/usr/bin:/bin" } }
  );
  console.log(`✓ Created ${certPath}`);
  console.log(`✓ Created ${keyPath}`);
}

// ── 3. Read and update config.yml ──
if (!fs.existsSync(configPath)) {
  console.log(`\nConfig not found at ${configPath}. Add to your config.yml:\n`);
  console.log("protocols:");
  console.log("  gemini:");
  console.log(
    `    certPath: "${path.relative(path.dirname(configPath), certPath)}"`
  );
  console.log(
    `    keyPath: "${path.relative(path.dirname(configPath), keyPath)}"`
  );
  process.exit(0);
}

const raw = fs.readFileSync(configPath, "utf-8"); // NOSONAR
const config = parse(raw);

// Ensure protocols.gemini exists
if (!config.protocols) {
  config.protocols = {};
}
if (!config.protocols.gemini) {
  config.protocols.gemini = { enabled: true, port: 1965 };
}

const relCert = path.relative(path.dirname(configPath), certPath); // NOSONAR
const relKey = path.relative(path.dirname(configPath), keyPath); // NOSONAR

config.protocols.gemini.certPath = relCert;
config.protocols.gemini.keyPath = relKey;

fs.writeFileSync(configPath, stringify(config, { lineWidth: 120 }), "utf-8"); // NOSONAR
console.log(`\n✓ Updated ${path.relative(process.cwd(), configPath)}`);
console.log(`  protocols.gemini.certPath: ${relCert}`);
console.log(`  protocols.gemini.keyPath: ${relKey}`);
