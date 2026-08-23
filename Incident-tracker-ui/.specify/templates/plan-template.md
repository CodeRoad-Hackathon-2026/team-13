# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript, strict mode — fixed by constitution (Technology Constraints)  
**Primary Dependencies**: React + React Hook Form — fixed. Routing / server-state cache /
charting / build tooling: [NEEDS CLARIFICATION — decide in this plan; charting must satisfy A11Y-4
and WCAG AA]  
**Storage**: N/A (no client-owned persistence; URL query string holds view state per Principle IX)  
**Testing**: React Testing Library — fixed. Test runner + E2E tool: [NEEDS CLARIFICATION]  
**Target Platform**: [e.g., evergreen desktop browsers or NEEDS CLARIFICATION]
**Project Type**: Single-page React frontend; backend consumed via PRD §9 endpoints  
**Performance Goals**: FMP < 2s on seeded dataset (P-1); KPI tiles paint before charts (P-2)  
**Constraints**: single request per aggregate, no N+1 (P-3); JSONB lazy-loaded only (P-4);
polling Band A 30s / Band B 5min with no layout jump (X-2, X-3)  
**Scale/Scope**: [domain-specific, e.g., seeded hackathon dataset size, number of panels]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Mark each gate PASS / VIOLATION (justify in Complexity Tracking) / N/A for this feature.

- [ ] **I. Contract-First** — component contracts (props, states, events, errors, loading, empty),
      API contracts against PRD §9, and derivation contracts declared before implementation. No
      invented endpoints, fields, tables, or columns.
- [ ] **II. Traceability** — every planned task cites a PRD requirement ID (`AR-*`, `IT-*`, `EO-*`,
      `TL-*`, `X-*`, `A11Y-*`, `P-*`) or a §11 acceptance criterion; no in-scope requirement is
      left uncovered.
- [ ] **III. Domain outside UI** — derivations/thresholds/metric math planned into `domain/` with
      an injected clock; components hold no business rules.
- [ ] **IV. Metric truthfulness** — median (not average) for resolution time; `ROLLED_BACK` its own
      bucket; funnel reconciles with the table; §6.1 automation-rate definition; every KPI drills in.
- [ ] **V. Guarded irreversible actions** — approve idempotent (sync disable, one in-flight),
      HIGH-risk confirm, reject requires reason, no mutation from mount/effect/poll/retry.
- [ ] **VI. HITL transparency** — confidence value, "why this action" evidence, failed agent runs
      expanded, AI-vs-human corrections surfaced.
- [ ] **VII. Four states** — loading / empty-no-data / empty-filtered / error specified per
      data-bound component, plus stale labeling.
- [ ] **VIII. Failure isolation** — per-panel error boundaries; no shared fetch whose failure
      blanks unrelated panels.
- [ ] **IX. URL is shareable state** — filters, drill-down, search, and open drawer in the query
      string; drawer is not a navigation.
- [ ] **X. Accessibility** — text label on every pill, WCAG AA, keyboard path + focus restore,
      tabular chart equivalents.
- [ ] **XI. Performance budgets** — P-1..P-4 and X-2/X-3 accounted for in the design.
- [ ] **XII. Testability** — mandatory test areas listed in Principle XII have planned tests;
      mocked HTTP boundary, injected clock, pinned timezone.
- [ ] **XIII. Least trust in client** — no secrets; server is the authorization gate; external
      strings rendered as text; `rel="noopener noreferrer"` on external links.
- [ ] **XIV. Scope discipline** — no v1 non-goals; `approval_required = FALSE` excluded from the
      queue; §10 schema gaps degraded explicitly, not worked around.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
