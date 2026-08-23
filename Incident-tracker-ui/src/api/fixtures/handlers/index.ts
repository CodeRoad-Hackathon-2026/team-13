import type { RequestHandler } from "msw";
import { alertStripHandlers } from "./alertStrip";
import { dashboardNowHandlers } from "./dashboardNow";
import { incidentsListHandlers } from "./incidentsList";
import { incidentsDetailHandlers } from "./incidentsDetail";
import { approvalsPendingHandlers } from "./approvalsPending";
import { approvalsActionsHandlers } from "./approvalsActions";
import { approvalsExecutionHandlers } from "./approvalsExecution";
import { dashboardPerformanceHandlers } from "./dashboardPerformance";
import { dashboardKnowledgeHandlers } from "./dashboardKnowledge";
import { dashboardBreakdownsHandlers } from "./dashboardBreakdowns";
import { feedbackImpactHandlers } from "./feedbackImpact";
import { feedbackHandlers } from "./feedback";
import { servicesHandlers } from "./services";
import { approvalsPreflightHandlers } from "./approvalsPreflight";
import { agentsHandlers } from "./agents";

// Foundational (T010) creates this barrel empty; each phase appends its own handler module.
export const handlers: RequestHandler[] = [
  ...alertStripHandlers,
  ...dashboardNowHandlers,
  ...incidentsListHandlers,
  ...incidentsDetailHandlers,
  ...approvalsPendingHandlers,
  ...approvalsActionsHandlers,
  ...approvalsExecutionHandlers,
  ...dashboardPerformanceHandlers,
  ...dashboardKnowledgeHandlers,
  ...dashboardBreakdownsHandlers,
  ...feedbackImpactHandlers,
  ...feedbackHandlers,
  ...servicesHandlers,
  ...approvalsPreflightHandlers,
  ...agentsHandlers,
];
