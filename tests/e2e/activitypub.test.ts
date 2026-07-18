import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiUrl } from "./helpers.js";
import { setupE2e, teardownE2e } from "./setup.js";

beforeAll(async () => {
  await setupE2e();
}, 30_000);

afterAll(async () => {
  await teardownE2e();
}, 10_000);

describe("ActivityPub E2E", () => {
  it("serves WebFinger endpoint", async () => {
    // The WebFinger handler captures canonicalBase at registration time,
    // which is http://localhost:0 before the server starts
    const res = await fetch(
      apiUrl("/.well-known/webfinger?resource=acct:e2e-author@localhost:0")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe("acct:e2e-author@localhost:0");
  });

  it("returns 400 for missing resource on WebFinger", async () => {
    const res = await fetch(apiUrl("/.well-known/webfinger"));
    expect(res.status).toBe(400);
  });

  it("serves Actor endpoint", async () => {
    const res = await fetch(apiUrl("/actor"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("Person");
    expect(body.inbox).toContain("/inbox");
    expect(body.outbox).toContain("/outbox");
  });

  it("serves Outbox endpoint", async () => {
    const res = await fetch(apiUrl("/outbox"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("OrderedCollection");
  });

  it("accepts a Follow activity", async () => {
    const res = await fetch(apiUrl("/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify({
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Follow",
        actor: "https://remote.example.com/actor",
        object: "http://localhost:8080/actor",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
  });
});
