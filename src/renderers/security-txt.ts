import type { SecurityTxtConfig } from "../types/config.js";

export function renderSecurityTxt(config: SecurityTxtConfig): string {
  if (config.contact.length === 0 || !config.expires) {
    return "";
  }

  const lines: string[] = [];

  for (const contact of config.contact) {
    lines.push(`Contact: ${contact}`);
  }

  lines.push(`Expires: ${config.expires}`);

  if (config.encryption) {
    lines.push(`Encryption: ${config.encryption}`);
  }

  if (config.acknowledgments) {
    lines.push(`Acknowledgments: ${config.acknowledgments}`);
  }

  if (config.preferredLanguages) {
    lines.push(`Preferred-Languages: ${config.preferredLanguages}`);
  }

  if (config.canonical) {
    for (const url of config.canonical) {
      lines.push(`Canonical: ${url}`);
    }
  }

  if (config.policy) {
    lines.push(`Policy: ${config.policy}`);
  }

  if (config.hiring) {
    lines.push(`Hiring: ${config.hiring}`);
  }

  if (config.csaf) {
    lines.push(`CSAF: ${config.csaf}`);
  }

  lines.push("");
  return lines.join("\n");
}
