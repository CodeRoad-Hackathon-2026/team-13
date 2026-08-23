import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchServices } from "./services";
import type { ServicesData } from "./services";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const body: ServicesData = {
  services: [
    { id: "11111111-1111-1111-1111-111111111111", name: "payments-api" },
    { id: "22222222-2222-2222-2222-222222222222", name: "checkout-web" },
  ],
};

describe("fetchServices contract", () => {
  it("returns the service catalogue for the service filter (FR-003)", async () => {
    server.use(http.get("/api/services", () => HttpResponse.json(body)));

    const result = await fetchServices();

    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("payments-api");
  });

  // The ids are what the filter sends back to every endpoint behind it, and those
  // compare against the `services.id` UUID column — a slug there is a 400.
  it("carries services.id UUIDs, not slugs", async () => {
    server.use(http.get("/api/services", () => HttpResponse.json(body)));

    const result = await fetchServices();

    for (const svc of result.services) {
      expect(svc.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });
});
