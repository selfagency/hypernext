import { describe, expect, it } from "vitest";
import { walineConfigToEnv } from "../src/comments/waline/env";

describe("waline-env", () => {
  describe("walineConfigToEnv", () => {
    it("should map basic config to env vars", () => {
      const config = {
        site: {
          canonicalBase: "https://comments.example.com",
          meta: { title: "Test Site" },
        },
        comments: {
          waline: {
            enabled: true,
            mode: "embedded",
            serverURL: "https://comments.example.com",
          },
        },
      } as Parameters<typeof walineConfigToEnv>[0];

      const env = walineConfigToEnv(config, "test-jwt-token");

      expect(env.SITE_URL).toBe("https://comments.example.com");
      expect(env.SITE_NAME).toBe("Test Site");
    });

    it("should map SQLite storage config", () => {
      const config = {
        site: { canonicalBase: "https://example.com", meta: {} },
        comments: {
          waline: {
            enabled: true,
            mode: "embedded",
            serverURL: "https://example.com",
            storage: { type: "sqlite", path: "./comments.db" },
          },
        },
      } as Parameters<typeof walineConfigToEnv>[0];

      const env = walineConfigToEnv(config, "token");

      expect(env.SQLITE_PATH).toBe("./comments.db");
    });

    it("should map email notification config", () => {
      const config = {
        site: { canonicalBase: "https://example.com", meta: {} },
        comments: {
          waline: {
            enabled: true,
            mode: "embedded",
            serverURL: "https://example.com",
            notifications: {
              email: {
                host: "smtp.example.com",
                port: 587,
                user: "notifications@example.com",
                password: "smtp-password",
                from: "Waline <noreply@example.com>",
              },
            },
          },
        },
      } as Parameters<typeof walineConfigToEnv>[0];

      const env = walineConfigToEnv(config, "token");

      expect(env.SMTP_HOST).toBe("smtp.example.com");
      expect(env.SMTP_PORT).toBe("587");
      expect(env.SMTP_USER).toBe("notifications@example.com");
    });

    it("should map anti-spam config", () => {
      const config = {
        site: { canonicalBase: "https://example.com", meta: {} },
        comments: {
          waline: {
            enabled: true,
            mode: "embedded",
            serverURL: "https://example.com",
            antiSpam: {
              akismet: true,
              ipqps: 5,
              secureDomains: ["example.com"],
            },
          },
        },
      } as Parameters<typeof walineConfigToEnv>[0];

      const env = walineConfigToEnv(config, "token");

      expect(env.AKISMET_KEY).toBe("true");
      expect(env.IPQPS).toBe("5");
    });

    it("should return empty object when no waline config", () => {
      const config = {
        site: { canonicalBase: "https://example.com", meta: {} },
      };
      const env = walineConfigToEnv(
        config as Parameters<typeof walineConfigToEnv>[0],
        "token"
      );
      expect(Object.keys(env).length).toBe(0);
    });
  });
});
