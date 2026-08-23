import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./state/queryClient";
import { OperatorProvider } from "./state/OperatorContext";
import { useUrlState } from "./state/useUrlState";
import { useAlertStrip } from "./api/dashboard/alertStrip";
import { DashboardHeader } from "./components/layout/DashboardHeader";
import { AlertStrip } from "./components/layout/AlertStrip";
import { TabBar } from "./components/layout/TabBar";
import { TabPanel } from "./components/layout/TabPanel";
import { KpiStripNow } from "./components/kpi/KpiStrip.now";
import { IncidentTable } from "./components/incidents/IncidentTable";
import { IncidentDetailDrawer } from "./components/incidents/IncidentDetailDrawer";
import { ApprovalQueue } from "./components/approvals/ApprovalQueue";
import { CrossTabToast } from "./components/shared/CrossTabToast";
import { KpiStripPerformance } from "./components/kpi/KpiStrip.performance";
import { AutomationFunnelPanel } from "./components/charts/AutomationFunnelPanel";
import { ExecutionOutcomeDonutPanel } from "./components/charts/ExecutionOutcomeDonutPanel";
import { VolumeChartPanel } from "./components/charts/VolumeChartPanel";
import { PriorityBreakdownPanel } from "./components/charts/PriorityBreakdownPanel";
import { AgentTabPanel } from "./components/agent/AgentTabPanel";
import { ActionTypePerformancePanel } from "./components/charts/ActionTypePerformancePanel";
import { CategoryBreakdownPanel } from "./components/charts/CategoryBreakdownPanel";
import { ServiceBreakdownPanel } from "./components/charts/ServiceBreakdownPanel";
import { KpiStripKnowledge } from "./components/kpi/KpiStrip.knowledge";
import { CoverageGapsChartPanel } from "./components/charts/CoverageGapsChartPanel";
import { DocumentsDrivingResolutionsPanel } from "./components/charts/DocumentsDrivingResolutionsPanel";
import { DocumentationCandidates } from "./components/charts/DocumentationCandidates";

function Dashboard() {
  const { tab } = useUrlState();
  const { data: alertStrip } = useAlertStrip();

  return (
    <div className="min-h-screen bg-background">
      {/*
        Header + alert strip + tab bar form one sticky top block. The strip is deliberately inside
        it and outside every TabPanel (AS-1/X-2): it must stay visible and keep its own 30s poll no
        matter which tab is active.
      */}
      <div className="sticky top-0 z-40 bg-card shadow-md">
        <DashboardHeader />
        <AlertStrip />
        <TabBar pendingApprovalCount={alertStrip?.awaitingApproval ?? 0} />
      </div>
      <main className="mx-auto w-full max-w-[1360px] px-6 pb-20">
        <TabPanel tab="now" activeTab={tab}>
          <KpiStripNow />
          <ApprovalQueue />
          <IncidentTable />
        </TabPanel>
        <TabPanel tab="performance" activeTab={tab}>
          <KpiStripPerformance />
          {/* The funnel and the outcome donut answer one question between them — where work is
              lost, and whether what survives actually worked — so they sit side by side at the
              top rather than as two full-width cards to scroll between. Both are dense enough to
              hold a half-width column and short enough to end at roughly the same place. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AutomationFunnelPanel />
            <ExecutionOutcomeDonutPanel />
          </div>
          <VolumeChartPanel />
          {/* The three breakdowns are the same shape at the same altitude, so they read as one
              row of small multiples rather than three full-width charts to scroll past. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <PriorityBreakdownPanel />
            <CategoryBreakdownPanel />
            <ServiceBreakdownPanel />
          </div>
          <ActionTypePerformancePanel />
        </TabPanel>
        <TabPanel tab="agent" activeTab={tab}>
          <AgentTabPanel />
        </TabPanel>
        <TabPanel tab="knowledge" activeTab={tab}>
          <KpiStripKnowledge />
          <CoverageGapsChartPanel />
          <DocumentsDrivingResolutionsPanel />
          <DocumentationCandidates />
        </TabPanel>
      </main>
      <IncidentDetailDrawer />
      <CrossTabToast />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <OperatorProvider>
        <Dashboard />
      </OperatorProvider>
    </QueryClientProvider>
  );
}
