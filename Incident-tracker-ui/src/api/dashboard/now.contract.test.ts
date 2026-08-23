import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchNowTiles } from "./now";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("fetchNowTiles contract", () => {
  it("returns exactly the four operational tiles, never p1Active or awaitingApproval (FR-027)", async () => {
    const body = {
      openIncidents: { value: 6, deltaVsPrevious: -1 },
      escalated: { value: 1, deltaVsPrevious: 0 },
      unassigned: { value: 3, deltaVsPrevious: 1 },
      oldestOpen: { ageMinutes: 340, priority: "P4" },
    };
    server.use(http.get("/api/dashboard/now", () => HttpResponse.json(body)));

    const result = await fetchNowTiles();

    expect(result.openIncidents.value).toBe(6);
    expect(result.escalated.value).toBe(1);
    expect(result.unassigned.value).toBe(3);
    expect(result.oldestOpen.ageMinutes).toBe(340);
    expect(result).not.toHaveProperty("p1Active");
    expect(result).not.toHaveProperty("awaitingApproval");
  });

  it("passes env and service as query params", async () => {
    // A `let` reassigned only inside the MSW callback narrows to `never` at the read site below
    // (a real TS control-flow quirk, confirmed in isolation) — a mutated object property avoids it.
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/dashboard/now", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json({
          openIncidents: { value: 0, deltaVsPrevious: 0 },
          escalated: { value: 0, deltaVsPrevious: 0 },
          unassigned: { value: 0, deltaVsPrevious: 0 },
          oldestOpen: { ageMinutes: null, priority: null },
        });
      }),
    );

    await fetchNowTiles({ environment: ["Production", "Staging"], service: "svc-payments-api" });

    expect(captured.url?.searchParams.get("env")).toBe("Production,Staging");
    expect(captured.url?.searchParams.get("service")).toBe("svc-payments-api");
  });
});
