import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchExecutionStatus } from "./execution";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("fetchExecutionStatus contract", () => {
  it("returns status, errorMessage, startedAt, finishedAt (FR-040,AR-7)", async () => {
    server.use(
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({
          status: "RUNNING",
          errorMessage: null,
          startedAt: "2026-08-17T12:00:00Z",
          finishedAt: null,
        }),
      ),
    );

    const result = await fetchExecutionStatus("exec-a1");

    expect(result).toEqual({
      status: "RUNNING",
      errorMessage: null,
      startedAt: "2026-08-17T12:00:00Z",
      finishedAt: null,
    });
  });

  it("surfaces ROLLED_BACK as its own status, not a synonym for FAILED (EO-1)", async () => {
    server.use(
      http.get("/api/actions/:id/execution", () =>
        HttpResponse.json({
          status: "ROLLED_BACK",
          errorMessage: "Rolled back after validation failure",
          startedAt: "2026-08-17T12:00:00Z",
          finishedAt: "2026-08-17T12:01:00Z",
        }),
      ),
    );

    const result = await fetchExecutionStatus("exec-a1");

    expect(result.status).toBe("ROLLED_BACK");
  });
});
