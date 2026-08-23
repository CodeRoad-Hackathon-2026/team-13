import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchFeedbackImpact } from "./feedbackImpact";
import type { FeedbackImpactData } from "./feedbackImpact";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: FeedbackImpactData = {
  personal: { accuracyPercent: 84, previousAccuracyPercent: 71, correctionCount: 12, lastCorrectionAt: "2026-08-14T09:00:00Z" },
  team: { correctionCount: 61, engineerCount: 4, quarterLabel: "Q3 2026" },
  suppressed: false,
};

describe("fetchFeedbackImpact contract", () => {
  it("sends only the operator name — never from/to, even though the endpoint signature suggests otherwise (Assumption 15)", async () => {
    const captured: { url: URL | null } = { url: null };
    server.use(
      http.get("/api/feedback/impact", ({ request }) => {
        captured.url = new URL(request.url);
        return HttpResponse.json(body);
      }),
    );

    await fetchFeedbackImpact("a.reyes");

    expect(captured.url?.searchParams.get("user")).toBe("a.reyes");
    expect(captured.url?.searchParams.has("from")).toBe(false);
    expect(captured.url?.searchParams.has("to")).toBe(false);
  });

  it("returns distinct personal and team shapes, never merged (FI-1,FI-2)", async () => {
    server.use(http.get("/api/feedback/impact", () => HttpResponse.json(body)));

    const result = await fetchFeedbackImpact("a.reyes");

    expect(result.personal.accuracyPercent).toBe(84);
    expect(result.personal.previousAccuracyPercent).toBe(71);
    expect(result.team.correctionCount).toBe(61);
    expect(result.team.engineerCount).toBe(4);
  });

  it("surfaces the suppressed flag (FI-4,FR-077)", async () => {
    server.use(
      http.get("/api/feedback/impact", () =>
        HttpResponse.json({ ...body, team: { ...body.team, correctionCount: 4 }, suppressed: true }),
      ),
    );

    const result = await fetchFeedbackImpact("a.reyes");

    expect(result.suppressed).toBe(true);
  });
});
