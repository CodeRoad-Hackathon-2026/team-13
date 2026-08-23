#!/usr/bin/env python3
"""Generates docs/agent-map.svg — the inventory of agents, tools, sources and people.

Run it from the repository root:

    python docs/agent_map.py

Why a generator and not a hand-drawn image: the whole point of the picture is the
*status* of each box, and status changes. When the Validation Agent lands, someone
flips one word here and re-runs this, instead of the diagram quietly going stale
and telling a new reader something that stopped being true months ago.

Why SVG written by hand rather than Mermaid: this is a layered inventory with four
status colours and a legend, which Mermaid's layout engines will not produce.

Constraints that come from GitHub rendering this inside a sanitised <img>:
  * no external fonts — a webfont silently falls back, so only generic families;
  * no <foreignObject>, so no HTML text and therefore no automatic wrapping —
    every label is wrapped here and card heights are computed from the line count;
  * an explicit light background rect, so the picture still reads on GitHub's dark
    theme instead of putting dark text on a dark page.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field

# ---------------------------------------------------------------- palette

NAVY = "#1a4f7a"
TEAL = "#2aa9bd"
INK = "#1f2933"
MUTED = "#5b6673"
FAINT = "#8b95a3"
GROUP_BG = "#f8fafc"
GROUP_RULE = "#dde4ec"
PAGE = "#ffffff"

STYLES = {
    # status              fill        stroke     text       dashed
    "current": ("#eaf6f0", "#2f8f6b", "#14532d", False),
    "inprogress": ("#fdf3e6", "#d98324", "#7c4a03", False),
    "planned": ("#eef3fa", "#7f9fc4", "#1e3a5f", False),
    "inrag": ("#f4f6f9", "#8b93a1", "#3f4855", True),
    "source": ("#1e3a5f", "#12263f", "#ffffff", False),
}

LEGEND = [
    ("current", "Built and running"),
    ("inprogress", "Partly built"),
    ("planned", "Not built yet"),
    ("inrag", "In RAG Core, not wired"),
]

FONT = "DejaVu Sans, Verdana, Geneva, sans-serif"

# ---------------------------------------------------------------- geometry

W = 1440
M = 28
LEFT_X, LEFT_W = M, 1010
GAP = 26
RIGHT_X = LEFT_X + LEFT_W + GAP
RIGHT_W = W - RIGHT_X - M

PAD = 14          # group box inner padding
CARD_GAP = 10
TITLE_LH = 15     # line height, card title
NOTE_LH = 13      # line height, card note
NOTE_GAP = 3

# Average glyph advance as a fraction of font-size, for DejaVu Sans. Only used to
# decide where to break a line; a slight over-estimate is safe (an extra line
# looks fine, an overflowing one does not).
BOLD_RATIO = 0.60
BODY_RATIO = 0.55


@dataclass
class Card:
    title: str
    note: str = ""
    status: str = "current"


@dataclass
class Row:
    cards: list[Card]
    cols: int
    label: str = ""
    title_size: float = 12.5
    note_size: float = 10.5


@dataclass
class Tier:
    label: str
    rows: list[Row]
    boxed: bool = True


# ---------------------------------------------------------------- content
#
# Every status below is a claim about the code. The evidence for each one is in
# docs/architecture.md and in the plan that produced this file; if you change a
# status here, change it because you read the module, not because it feels right.

ORCHESTRATOR = Tier(
    "",
    [Row([Card("Orchestrator",
               "app/agents/pipeline.py — classify, retrieve, decide, in order")], cols=1)],
    boxed=False,
)

CAPABILITY = Tier("Capability agents — db/seeds/001_agents.sql", [
    Row([
        Card("Incident Intake Agent", "parses inbound payloads into an incident"),
        Card("Classification Agent", "category, priority, service, environment"),
        Card("RAG Retrieval Agent", "similar incidents, runbooks, postmortems"),
        Card("Decision Agent", "decides if it is known, proposes actions"),
        Card("Execution Agent", "runs an approved action through a tool"),
        Card("Knowledge Generation Agent", "turns a resolved incident into a document"),
        Card("Change Delivery Agent", "applies the patch and commits — pushing off by default",
             "inprogress"),
        Card("Validation Agent", "seeded in the registry, no module — why the funnel ends early",
             "planned"),
    ], cols=4),
])

TOOLS = Tier("Tool agents", [
    Row([
        Card("API tool", "HttpTool — action_type API"),
        Card("Webhook tool", "HttpTool — action_type WEBHOOK"),
        Card("GitHub branch push", "handled by Change Delivery, not the registry", "inprogress"),
        Card("SQL tool", "in the vocabulary, no executor registered", "planned"),
        Card("Lambda tool", "in the vocabulary, no executor registered", "planned"),
        Card("Kubernetes tool", "in the vocabulary, no executor registered", "planned"),
    ], cols=3, label="Execution tools — app/tools/__init__.py"),
    Row([
        Card("rag_search", "raw passages with scores"),
        Card("rag_answer", "grounded answer with citations"),
        Card("rag_ingest", "writes what we learned back"),
        Card("rag_feedback", "rates a passage, feeds ranking"),
        Card("rag_list_collections", "how the corpus is organised"),
        Card("rag_pin_trace", "keeps a trace past retention — a PR's evidence 404s without it",
             "inrag"),
        Card("rag_incident_traces", "replays what was already asked, including the gaps", "inrag"),
    ], cols=4, label="RAG Core tools — we call five of the seven"),
])

SOURCES = Tier("Data sources", [
    Row([
        Card("incident_response", "PostgreSQL 17 — incidents, actions, executions, runs", "source"),
        Card("rag", "PostgreSQL 17 + pgvector — the only vector store", "source"),
        Card("knowledge_documents → collection 'incidents'",
             "app/corpus.py — today the only thing feeding the corpus", "source"),
    ], cols=3, label="Connected"),
    Row([
        Card("Slack", status="inrag"),
        Card("Jira", status="inrag"),
        Card("Confluence", status="inrag"),
        Card("AWS CloudWatch Logs", status="inrag"),
        Card("Git repository", status="inrag"),
        Card("Filesystem", status="inrag"),
        Card("HTTP JSON", status="inrag"),
        Card("MCP server", status="inrag"),
    ], cols=8, label="Registered connectors in RAG Core — none configured", title_size=11),
])

HUMANS = [
    ("On-call engineer",
     "Triage the open queue, approve or reject what the agents propose, inspect what they did.",
     "Now"),
    ("Eng manager / SRE lead",
     "Judge whether the automation can be trusted, and where incidents concentrate.",
     "Performance"),
    ("Runbook owner",
     "Find which services the knowledge base cannot help with yet.",
     "Knowledge"),
]

CREW_NOTE = (
    "RAG Core also ships a CrewAI crew — Triage, Investigator, Remediation — that overlaps "
    "this pipeline. We do not use it: our orchestrator calls the API directly, so the "
    "confidence gate and the groundedness judge still apply. Worth a decision, not a default."
)

# Ranked, so the numbering carries real information: the first one is already
# losing evidence on every PR we push, the last one costs nothing today.
NEXT_MOVES = [
    ("Pin the trace when a branch is pushed",
     "rag_pin_trace is already there. Without it the evidence behind a merged PR 404s "
     "once the retention window passes — exactly when someone audits the decision."),
    ("Point one connector at something real",
     "Eight are registered and none configured, so the corpus can only ever contain what we "
     "wrote back into it ourselves."),
    ("Implement the Validation Agent, or unseed it",
     "It is in the registry, so the funnel reserves a stage for it and reports "
     "“Not yet available” rather than a number."),
]

# ---------------------------------------------------------------- primitives

out: list[str] = []


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def wrap(text: str, max_px: float, size: float, ratio: float) -> list[str]:
    if not text:
        return []
    max_chars = max(4, int(max_px / (size * ratio)))
    lines: list[str] = []
    cur = ""
    for word in text.split():
        cand = word if not cur else f"{cur} {word}"
        if len(cand) <= max_chars:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def text(x, y, s, size, *, fill=INK, weight="normal", anchor="start",
         style="normal", spacing=None):
    attrs = [
        f'x="{x:.1f}"', f'y="{y:.1f}"', f'font-family="{FONT}"',
        f'font-size="{size}"', f'fill="{fill}"',
    ]
    if weight != "normal":
        attrs.append(f'font-weight="{weight}"')
    if anchor != "start":
        attrs.append(f'text-anchor="{anchor}"')
    if style != "normal":
        attrs.append(f'font-style="{style}"')
    if spacing:
        attrs.append(f'letter-spacing="{spacing}"')
    out.append(f'<text {" ".join(attrs)}>{esc(s)}</text>')


def rect(x, y, w, h, fill, stroke=None, *, r=4, dashed=False, sw=1):
    attrs = [f'x="{x:.1f}"', f'y="{y:.1f}"', f'width="{w:.1f}"', f'height="{h:.1f}"',
             f'rx="{r}"', f'fill="{fill}"']
    if stroke:
        attrs.append(f'stroke="{stroke}"')
        attrs.append(f'stroke-width="{sw}"')
        if dashed:
            attrs.append('stroke-dasharray="5 3"')
    out.append(f'<rect {" ".join(attrs)}/>')


def line(x1, y1, x2, y2, stroke=GROUP_RULE, sw=1):
    out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
               f'stroke="{stroke}" stroke-width="{sw}"/>')


# ---------------------------------------------------------------- cards

def card_lines(c: Card, w: float, row: Row):
    inner = w - 16
    tl = wrap(c.title, inner, row.title_size, BOLD_RATIO)
    nl = wrap(c.note, inner, row.note_size, BODY_RATIO)
    return tl, nl


def card_height(tl, nl, row: Row) -> float:
    h = 20 + len(tl) * TITLE_LH
    if nl:
        h += NOTE_GAP + len(nl) * NOTE_LH
    return h


def draw_card(x, y, w, h, c: Card, row: Row):
    fill, stroke, ink, dashed = STYLES[c.status]
    rect(x, y, w, h, fill, stroke, dashed=dashed, sw=1.4)
    tl, nl = card_lines(c, w, row)

    block = len(tl) * TITLE_LH + (NOTE_GAP + len(nl) * NOTE_LH if nl else 0)
    cy = y + (h - block) / 2 + row.title_size * 0.82
    cx = x + w / 2
    for ln in tl:
        text(cx, cy, ln, row.title_size, fill=ink, weight="bold", anchor="middle")
        cy += TITLE_LH
    if nl:
        cy += NOTE_GAP - (TITLE_LH - NOTE_LH)
        sub = ink if c.status == "source" else MUTED
        for ln in nl:
            text(cx, cy, ln, row.note_size, fill=sub, anchor="middle")
            cy += NOTE_LH


def draw_row(x, y, avail_w, row: Row) -> float:
    """Draws one grid of cards, returns the y below it."""
    if row.label:
        text(x, y + 9, row.label, 10.5, fill=FAINT)
        y += 17

    cw = (avail_w - (row.cols - 1) * CARD_GAP) / row.cols
    heights: list[float] = []
    for c in row.cards:
        tl, nl = card_lines(c, cw, row)
        heights.append(card_height(tl, nl, row))

    # One height per grid row, so a card with a longer note does not sit
    # shorter than its neighbours and make the grid look broken.
    n_rows = (len(row.cards) + row.cols - 1) // row.cols
    row_h = [
        max(heights[i * row.cols:(i + 1) * row.cols] or [40])
        for i in range(n_rows)
    ]

    for i, c in enumerate(row.cards):
        r, col = divmod(i, row.cols)
        cx = x + col * (cw + CARD_GAP)
        cy = y + sum(row_h[:r]) + r * CARD_GAP
        draw_card(cx, cy, cw, row_h[r], c, row)

    return y + sum(row_h) + (n_rows - 1) * CARD_GAP


def draw_tier(y: float, tier: Tier) -> float:
    if tier.label:
        text(LEFT_X, y + 9, tier.label, 11, fill=MUTED)
        y += 16

    if not tier.boxed:
        # A single card, centred, with a connector down to the tier below.
        row = tier.rows[0]
        c = row.cards[0]
        w = 300
        x = LEFT_X + (LEFT_W - w) / 2
        tl, nl = card_lines(c, w, row)
        h = card_height(tl, nl, row)
        draw_card(x, y, w, h, c, row)
        line(x + w / 2, y + h, x + w / 2, y + h + 16, MUTED)
        return y + h + 16

    box_top = y
    inner_y = y + PAD
    for i, row in enumerate(tier.rows):
        if i:
            inner_y += 12
            line(LEFT_X + PAD, inner_y, LEFT_X + LEFT_W - PAD, inner_y)
            inner_y += 10
        inner_y = draw_row(LEFT_X + PAD, inner_y, LEFT_W - 2 * PAD, row)

    # The box is painted into the slot reserved before the cards were drawn, so
    # it sits under them rather than over them.
    box_h = inner_y + PAD - box_top
    out[BOX_INDEX.pop(0)] = (
        f'<rect x="{LEFT_X}" y="{box_top:.1f}" width="{LEFT_W}" '
        f'height="{box_h:.1f}" rx="6" fill="{GROUP_BG}" '
        f'stroke="{GROUP_RULE}" stroke-width="1"/>'
    )
    return box_top + box_h


BOX_INDEX: list[int] = []


def tier_with_box(y: float, tier: Tier) -> float:
    """Reserves a slot for the group rect so it paints under its cards."""
    if tier.boxed:
        BOX_INDEX.append(len(out))
        out.append("")          # placeholder, filled in by draw_tier
    return draw_tier(y, tier)


# ---------------------------------------------------------------- page

def build() -> str:
    out.clear()

    BOX_INDEX.clear()
    body_start = 0  # placeholder index for the page rect

    out.append("")  # page background, sized once the height is known

    # ---- header
    text(M, 46, "Team of Agents and Humans", 30, fill=NAVY, weight="bold")
    text(M, 72, "Agents do the retrieval — people make every decision that leaves the database",
         14.5, fill=MUTED, style="italic")
    rect(M, 86, W - 2 * M, 3, TEAL, r=1.5)

    text(LEFT_X, 110, "TEAM OF AGENTS", 11.5, fill=NAVY, weight="bold", spacing="1.6")
    text(RIGHT_X, 110, "TEAM OF HUMANS", 11.5, fill=NAVY, weight="bold", spacing="1.6")

    # ---- legend, right-aligned inside the agents column
    chip_w, chip_h, chip_gap = 152, 21, 8
    lx = LEFT_X + LEFT_W - (len(LEGEND) * chip_w + (len(LEGEND) - 1) * chip_gap)
    for status, label in LEGEND:
        fill, stroke, ink, dashed = STYLES[status]
        rect(lx, 96, chip_w, chip_h, fill, stroke, r=3, dashed=dashed, sw=1.2)
        text(lx + chip_w / 2, 111, label, 10, fill=ink, anchor="middle")
        lx += chip_w + chip_gap

    # ---- agent tiers
    y = 130
    y = tier_with_box(y, ORCHESTRATOR)
    for tier in (CAPABILITY, TOOLS, SOURCES):
        y += 20
        y = tier_with_box(y, tier)
    left_bottom = y

    # ---- humans
    hy = 130
    hx, hw = RIGHT_X, RIGHT_W
    for role, job, tab in HUMANS:
        job_lines = wrap(job, hw - 46, 11, BODY_RATIO)
        h = 34 + len(job_lines) * 14 + 22
        rect(hx, hy, hw, h, "#f4f8fc", GROUP_RULE, r=5)
        rect(hx, hy, 4, h, TEAL, r=2)
        text(hx + 18, hy + 26, role, 15.5, fill=NAVY, weight="bold")
        ty = hy + 44
        for ln in job_lines:
            text(hx + 18, ty, ln, 11, fill=MUTED)
            ty += 14
        rect(hx + 18, ty - 4, 9 + len(tab) * 6.6, 17, "#e6eef7", "#b7c9dd", r=3)
        text(hx + 22, ty + 8.5, tab, 10, fill=NAVY, weight="bold")
        hy += h + 12

    # ---- the crew note, under the people
    hy += 8
    note_lines = wrap(CREW_NOTE, hw - 32, 11, BODY_RATIO)
    nh = 30 + len(note_lines) * 14.5
    rect(hx, hy, hw, nh, "#fdf9ef", "#e3d3ad", r=5, dashed=True)
    text(hx + 16, hy + 21, "NOT USED — WORTH A DECISION", 9.5, fill="#8a6d1f",
         weight="bold", spacing="1.2")
    ny = hy + 39
    for ln in note_lines:
        text(hx + 16, ny, ln, 11, fill="#6b5a2e")
        ny += 14.5
    # ---- the gaps worth acting on, which is what the four colours are for
    hy += nh + 22
    text(hx, hy, "WHAT THE COLOURS ARE POINTING AT", 9.5, fill=NAVY, weight="bold",
         spacing="1.2")
    hy += 14
    for i, (head, body) in enumerate(NEXT_MOVES, 1):
        head_lines = wrap(head, hw - 34, 12, BOLD_RATIO)
        body_lines = wrap(body, hw - 34, 10.5, BODY_RATIO)
        h = 14 + len(head_lines) * 14 + len(body_lines) * 13.5 + 12
        rect(hx, hy, hw, h, GROUP_BG, GROUP_RULE, r=5)
        text(hx + 12, hy + 25, str(i), 17, fill="#c3ced9", weight="bold")
        ty = hy + 24
        for ln in head_lines:
            text(hx + 32, ty, ln, 12, fill=NAVY, weight="bold")
            ty += 14
        ty += 2
        for ln in body_lines:
            text(hx + 32, ty, ln, 10.5, fill=MUTED)
            ty += 13.5
        hy += h + 8
    right_bottom = hy

    # ---- footer
    y = max(left_bottom, right_bottom) + 26
    line(M, y, W - M, y, GROUP_RULE)
    y += 20
    text(M, y, "CR-INC-Backend  ·  Incident-tracker-ui  ·  rag-core (RAG Core)",
         10.5, fill=FAINT, weight="bold")
    text(W - M, y, "Nothing runs that a person did not approve", 10.5, fill=FAINT,
         anchor="end", weight="bold")
    y += 18
    text(W / 2, y, "A rejection is not discarded — it goes back to RAG Core as a rating, "
                   "so the sources behind a bad recommendation rank lower next time",
         10.5, fill=MUTED, anchor="middle", style="italic")

    height = y + 24
    out[body_start] = f'<rect x="0" y="0" width="{W}" height="{height:.0f}" fill="{PAGE}"/>'

    header = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{height:.0f}" '
        f'viewBox="0 0 {W} {height:.0f}" role="img" '
        f'aria-label="Inventory of the incident response agents, tools, data sources '
        f'and the people who approve their work">'
    )
    return header + "\n" + "\n".join(out) + "\n</svg>\n"


if __name__ == "__main__":
    target = pathlib.Path(__file__).with_name("agent-map.svg")
    target.write_text(build())
    print(f"wrote {target}")
