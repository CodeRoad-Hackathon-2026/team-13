# Contract: Feedback

**Revised for PRD v2.0.** FR numbers match spec.md's post-re-spec numbering. This file covers the
feedback *write* only — the feedback-impact *read* (`GET /api/feedback/impact`, FR-074–FR-076) is
documented in `contracts/incidents-endpoints.md`, alongside the rest of the drawer's read-only
sections, since that's where it's consumed. A submission through this endpoint changes the
population the impact read is computed over on its next fetch, but the two are otherwise
independent — this endpoint does not return an updated accuracy figure itself.

## `POST /api/incidents/:id/feedback`

**Purpose**: Writes `developer_feedback` from the always-available §D7 form (FR-073).

**Consumed by**: `components/incidents/FeedbackForm` (inside the detail drawer, below the
feedback-impact widget).

**Request**:

```ts
{
  actor: string;                                  // FR-119
  feedbackType: "APPROVED" | "REJECTED" | "CORRECTED";
  comments: string;
  correctedCategory?: string;
  correctedPriority?: "P1" | "P2" | "P3" | "P4";
  correctedResolution?: string;
}
```

**Response**: `201 Created` with the new feedback row, in the same shape returned by
`GET /api/incidents/:id`'s `feedback` array — the client prepends it rather than re-fetching the
whole drawer (FR-073: "existing feedback listed above the form").

**Errors**: `404` if the incident id no longer exists (rare — no incident deletion exists in this
feature's scope).

**Side effects**: creates one `DeveloperFeedback` row, which becomes one more data point in the
feedback-impact accuracy computation (FR-075) on its next read — this endpoint does not itself
recompute or return that figure. Does not itself emit an `IncidentEvent` — the PRD ties event
emission to approve/reject (AR-8) specifically, not to every feedback submission.
