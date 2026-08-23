import { http, HttpResponse } from "msw";
import { DEVELOPER_FEEDBACK } from "../seededDataset";
import { computeAccuracyPercent, isSuppressed } from "../../../domain/feedbackAccuracy";
import type { FeedbackImpactData } from "../../feedbackImpact";

const ENGINEERS_THIS_QUARTER = new Set(DEVELOPER_FEEDBACK.map((f) => f.createdBy));

// FR-074-077/Assumption 15: personal is all-time for the named user; team is the fixed current
// quarter for everyone — this endpoint takes no from/to at all, and ignores any it's sent.
export const feedbackImpactHandlers = [
  http.get("/api/feedback/impact", ({ request }) => {
    const url = new URL(request.url);
    const user = url.searchParams.get("user") ?? "";

    const personalRows = DEVELOPER_FEEDBACK.filter((f) => f.createdBy === user);
    const personalAccuracy = computeAccuracyPercent(
      personalRows.map((f) => ({
        incidentId: f.incidentId,
        feedbackType: f.feedbackType,
        correctedCategory: f.correctedCategory,
        correctedPriority: f.correctedPriority,
      })),
    );
    const mostRecent = [...personalRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

    const teamCorrectionCount = DEVELOPER_FEEDBACK.length;

    const body: FeedbackImpactData = {
      personal: {
        // FR-076: all-time — no incidents means nothing to show, not a computed 0% claim.
        accuracyPercent: personalAccuracy ?? 0,
        previousAccuracyPercent: personalAccuracy !== null ? Math.max(0, personalAccuracy - 13) : 0,
        correctionCount: personalRows.length,
        lastCorrectionAt: mostRecent?.createdAt ?? null,
      },
      team: {
        correctionCount: teamCorrectionCount,
        engineerCount: ENGINEERS_THIS_QUARTER.size,
        quarterLabel: "Q3 2026",
      },
      suppressed: isSuppressed(teamCorrectionCount),
    };

    return HttpResponse.json(body);
  }),
];
