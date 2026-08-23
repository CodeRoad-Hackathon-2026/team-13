import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { approveAction } from "./approve";
import { rejectAction } from "./reject";
import { ApiError } from "../client";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("approveAction contract", () => {
  it("sends actor and confirmedHighRisk, returns the executing execution id (FR-037,FR-040)", async () => {
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/actions/:id/approve", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json({ executedActionId: "exec-1", status: "RUNNING" }, { status: 202 });
      }),
    );

    const result = await approveAction("act-a1", { actor: "a.reyes", confirmedHighRisk: true });

    expect(result).toEqual({ executedActionId: "exec-1", status: "RUNNING" });
    expect(captured.body).toEqual({ actor: "a.reyes", confirmedHighRisk: true });
  });

  it("surfaces a 400 when a HIGH-risk approve is missing confirmedHighRisk (FR-037)", async () => {
    server.use(
      http.post("/api/actions/:id/approve", () => new HttpResponse("confirmedHighRisk required", { status: 400 })),
    );

    await expect(approveAction("act-a1", { actor: "a.reyes" })).rejects.toMatchObject({ status: 400 });
  });

  it("surfaces a 409 when the action is no longer PROPOSED, for client-side reconciliation (AR-8)", async () => {
    server.use(http.post("/api/actions/:id/approve", () => new HttpResponse("already approved", { status: 409 })));

    const error = await approveAction("act-a1", { actor: "a.reyes" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(409);
  });
});

describe("rejectAction contract", () => {
  it("sends actor, reason, and optional corrections (FR-038)", async () => {
    const captured: { body: unknown } = { body: null };
    server.use(
      http.post("/api/actions/:id/reject", async ({ request }) => {
        captured.body = await request.json();
        return HttpResponse.json({ status: "REJECTED", approvedBy: "a.reyes", approvedAt: "2026-08-17T12:00:00Z" });
      }),
    );

    const result = await rejectAction("act-a3", {
      actor: "a.reyes",
      reason: "Already fixed manually",
      correctedCategory: "Database",
    });

    expect(result.status).toBe("REJECTED");
    expect(captured.body).toEqual({
      actor: "a.reyes",
      reason: "Already fixed manually",
      correctedCategory: "Database",
    });
  });

  it("surfaces a 400 when the server refuses an empty reason (FR-038,§11.3)", async () => {
    server.use(http.post("/api/actions/:id/reject", () => new HttpResponse("reason required", { status: 400 })));

    await expect(rejectAction("act-a3", { actor: "a.reyes", reason: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("surfaces a 409 when the action is no longer PROPOSED (AR-8)", async () => {
    server.use(http.post("/api/actions/:id/reject", () => new HttpResponse("already rejected", { status: 409 })));

    await expect(rejectAction("act-a3", { actor: "a.reyes", reason: "x" })).rejects.toMatchObject({ status: 409 });
  });
});
