import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DashboardHeader } from "./DashboardHeader";
import { OperatorProvider } from "../../state/OperatorContext";

// Real-shaped ids: the header's own contract is that whatever it puts in the URL
// is a `services.id`, because every endpoint behind the filter binds it as a UUID.
const PAYMENTS_ID = "11111111-1111-1111-1111-111111111111";

const server = setupServer(
  http.get("/api/services", () =>
    HttpResponse.json({
      services: [
        { id: PAYMENTS_ID, name: "payments-api" },
        { id: "22222222-2222-2222-2222-222222222222", name: "checkout-web" },
      ],
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

function renderHeader() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <DashboardHeader />
      </OperatorProvider>
    </QueryClientProvider>,
  );
}

describe("DashboardHeader", () => {
  it("defaults to the 7d time range and marks it pressed", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the URL when a different time range is selected", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(new URLSearchParams(window.location.search).get("range")).toBe("30d");
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "false");
  });

  it("explains via a tooltip that the range does not apply to Now or the alert strip (FR-004)", () => {
    renderHeader();
    // The explanation hangs off the time-range control itself rather than a separate "?" button.
    const group = screen.getByRole("group", { name: /time range/i });
    expect(group.title || group.getAttribute("data-tip")).toMatch(/now/i);
  });

  // FR-002 is a multi-select requirement, so it is asserted through the checkbox menu the header
  // actually renders rather than through a native <select>'s selectedOptions.
  it("defaults the environment filter to Production only", async () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /environment/i })).toHaveTextContent("Production");

    await userEvent.click(screen.getByRole("button", { name: /environment/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Production" })).toBeChecked();
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Staging" })).not.toBeChecked();
  });

  it("lets more than one environment be selected at once (FR-002)", async () => {
    renderHeader();
    await userEvent.click(screen.getByRole("button", { name: /environment/i }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Staging" }));

    expect(new URLSearchParams(window.location.search).get("env")).toBe("Production,Staging");
    expect(screen.getByRole("button", { name: /environment/i })).toHaveTextContent(
      "2 environments",
    );
  });

  it("offers a service dropdown defaulting to all services (FR-003)", async () => {
    renderHeader();
    const select = screen.getByLabelText<HTMLSelectElement>(/^service$/i);
    expect(select.value).toBe("all");

    // The options arrive from GET /api/services, so "all" is the only one on the
    // first render. They used to come from the MSW fixture module, which put
    // slugs like "svc-payments-api" into a filter every endpoint reads as a UUID.
    await screen.findByRole("option", { name: "payments-api" });

    fireEvent.change(select, { target: { value: PAYMENTS_ID } });
    expect(new URLSearchParams(window.location.search).get("service")).toBe(PAYMENTS_ID);
  });

  it("shows a live indicator and a manual refresh control", () => {
    renderHeader();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  // FR-121 is asserted through the avatar chip the header now renders: initials in the header,
  // full name and the change affordance inside its menu.
  describe("operator name (FR-121)", () => {
    it("shows that no name is set and offers to set one when none exists", async () => {
      renderHeader();
      await userEvent.click(screen.getByRole("button", { name: /operator/i }));

      expect(await screen.findByText(/no name set/i)).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /set name/i })).toBeInTheDocument();
    });

    it("can set a name, which then displays and persists", async () => {
      renderHeader();
      await userEvent.click(screen.getByRole("button", { name: /operator/i }));
      await userEvent.click(await screen.findByRole("menuitem", { name: /set name/i }));
      await userEvent.type(screen.getByRole("textbox", { name: /your name/i }), "a.reyes");
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

      // The chip carries the initials; the full name stays reachable through its label.
      expect(screen.getByRole("button", { name: /operator: a\.reyes/i })).toHaveTextContent("AR");
      expect(window.localStorage.getItem("incident-tracker:operator-name")).toBe("a.reyes");
    });

    it("shows the existing name and offers to change it", async () => {
      window.localStorage.setItem("incident-tracker:operator-name", "a.reyes");
      renderHeader();

      await userEvent.click(screen.getByRole("button", { name: /operator: a\.reyes/i }));
      expect(await screen.findByText("a.reyes")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("menuitem", { name: /change name/i }));
      await userEvent.clear(screen.getByRole("textbox", { name: /your name/i }));
      await userEvent.type(screen.getByRole("textbox", { name: /your name/i }), "j.chen");
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

      expect(screen.getByRole("button", { name: /operator: j\.chen/i })).toHaveTextContent("JC");
    });
  });
});
