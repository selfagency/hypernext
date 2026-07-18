import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiUrl } from "./helpers.js";
import { setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("IndieAuth E2E", () => {
  it("serves OAuth authorization server metadata", async () => {
    const res = await fetch(apiUrl("/.well-known/oauth-authorization-server"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_endpoint).toContain("/auth/authorize");
    expect(body.token_endpoint).toContain("/auth/token");
  });

  it("authorization endpoint returns redirect with code", async () => {
    const res = await fetch(
      apiUrl(
        "/auth/authorize?response_type=code&client_id=http://localhost&redirect_uri=http://localhost/callback&state=test-state&me=http://localhost:8080"
      ),
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("code=");
    expect(location).toContain("state=test-state");
  });

  it("token endpoint returns access token", async () => {
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
    expect(tokenRes.status).toBe(200);
    const tokenBody = await tokenRes.json();
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.token_type).toBe("Bearer");
  });
});
