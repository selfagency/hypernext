import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiUrl } from "./helpers.js";
import { setupE2e, teardownE2e } from "./setup.js";

let accessToken: string;

beforeAll(async () => {
  await setupE2e();

  // Get an access token for Micropub
  const authRes = await fetch(
    apiUrl(
      "/auth/authorize?response_type=code&client_id=http://localhost&redirect_uri=http://localhost/callback&state=s&me=http://localhost:8080"
    ),
    { redirect: "manual" }
  );
  const location = authRes.headers.get("location") ?? "";
  const code = new URL(location).searchParams.get("code");

  const tokenRes = await fetch(apiUrl("/auth/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: "http://localhost",
      redirect_uri: "http://localhost/callback",
    }),
  });
  accessToken = (await tokenRes.json()).access_token;
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("Micropub E2E", () => {
  it("creates a post with valid token", async () => {
    const res = await fetch(apiUrl("/micropub"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: ["h-entry"],
        properties: {
          name: ["E2E Test Post"],
          content: ["This is a test post created via Micropub."],
          category: ["e2e", "test"],
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBeTruthy();
  });

  it("rejects request without token", async () => {
    const res = await fetch(apiUrl("/micropub"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: ["h-entry"],
        properties: {
          name: ["Unauthorized"],
          content: ["Should not be created"],
        },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects request with invalid token", async () => {
    const res = await fetch(apiUrl("/micropub"), {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: ["h-entry"],
        properties: { name: ["Bad Token"], content: ["Should not be created"] },
      }),
    });
    expect(res.status).toBe(401);
  });
});
