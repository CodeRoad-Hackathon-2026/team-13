import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SkillForm } from "./SkillForm";
import type { AgentSkill } from "../../api/agents/roster";

const ACTION_TYPES = {
  actionTypes: [
    { actionType: "API", hasExecutor: true, executor: "http tool" },
    { actionType: "SQL", hasExecutor: false, executor: null },
  ],
  riskLevels: ["LOW", "MEDIUM", "HIGH"],
  environments: ["Development", "Production", "Staging"],
};

const server = setupServer(
  http.get("/api/action-types", () => HttpResponse.json(ACTION_TYPES)),
  http.get("/api/services", () =>
    HttpResponse.json({ services: [{ id: "svc-1", name: "payments-api" }] }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderForm(props: Partial<Parameters<typeof SkillForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SkillForm onSubmit={onSubmit} onCancel={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
  return { onSubmit };
}

const skill: AgentSkill = {
  id: "skill-1",
  name: "Purge the CDN cache",
  description: "Soft purge by surrogate key.",
  actionType: "API",
  riskLevel: "MEDIUM",
  serviceId: "svc-1",
  serviceName: "payments-api",
  environments: ["Production"],
  enabled: true,
  usage: { runs: 61, successPercent: 98, scope: "action type" },
};

describe("SkillForm", () => {
  it("requires a name and an action type", async () => {
    const { onSubmit } = renderForm();
    await screen.findByRole("button", { name: /add skill/i });

    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));

    expect(await screen.findByText(/a name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/an action type is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // The point of the whole increment: SQL, LAMBDA and KUBERNETES are in the
  // planner's vocabulary with nothing registered to carry them out. Pre-flight
  // says so on the approval card; this says it before the skill exists.
  it("marks an action type that nothing can carry out", async () => {
    renderForm();

    const option = await screen.findByRole("option", { name: /SQL — no executor/i });

    expect(option).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^API$/ })).toBeInTheDocument();
  });

  it("warns, in a sentence, once such a type is chosen", async () => {
    renderForm();
    await screen.findByRole("option", { name: /SQL/i });

    fireEvent.change(screen.getByLabelText(/action type/i), { target: { value: "SQL" } });

    expect(
      await screen.findByText(/approving it would fail immediately without attempting anything/i),
    ).toBeInTheDocument();
  });

  it("does not warn for a type that has an executor", async () => {
    renderForm();
    await screen.findByRole("option", { name: /^API$/ });

    fireEvent.change(screen.getByLabelText(/action type/i), { target: { value: "API" } });

    expect(screen.queryByText(/fail immediately/i)).not.toBeInTheDocument();
  });

  it("still lets the skill be created — the warning is not a block", async () => {
    const { onSubmit } = renderForm();
    await screen.findByRole("option", { name: /SQL/i });

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Scale replicas" } });
    fireEvent.change(screen.getByLabelText(/action type/i), { target: { value: "SQL" } });
    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Scale replicas", actionType: "SQL" });
  });

  it("pre-fills from an existing skill, selecting the service by id", async () => {
    renderForm({ skill });
    await screen.findByRole("option", { name: "payments-api" });

    expect(screen.getByLabelText(/^name/i)).toHaveValue("Purge the CDN cache");
    // By id, not by display name: the name is not the key.
    expect(screen.getByLabelText(/service/i)).toHaveValue("svc-1");
    expect(screen.getByLabelText("Production")).toBeChecked();
    expect(screen.getByLabelText("Staging")).not.toBeChecked();
  });

  it("offers Save changes and Remove when editing, and neither when creating", async () => {
    const onDelete = vi.fn();
    renderForm({ skill, onDelete });

    expect(await screen.findByRole("button", { name: /save changes/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove skill/i }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("sends an explicit null to clear the service, not an omitted field", async () => {
    // The server distinguishes them, and collapsing the two would make renaming
    // a skill silently unbind it.
    const { onSubmit } = renderForm({ skill });
    await screen.findByRole("option", { name: "payments-api" });

    fireEvent.change(screen.getByLabelText(/service/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toHaveProperty("serviceId", null);
  });

  // The bug the loading gate exists for: react-hook-form reads defaultValues once,
  // so a select rendered before its options arrive falls back to "" — and saving
  // would then write an empty serviceId over a real one.
  it("waits for its option lists rather than rendering a select that cannot hold its value", () => {
    renderForm({ skill });

    expect(screen.getByRole("status")).toHaveTextContent(/loading the action types/i);
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });

  it("associates its errors with the control that failed", async () => {
    renderForm();
    await screen.findByRole("button", { name: /add skill/i });

    fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    await screen.findByText(/a name is required/i);

    const input = screen.getByLabelText(/^name/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "skill-name-error");
  });
});
