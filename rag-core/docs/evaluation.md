# Evaluation

```bash
make eval           # every dataset, retrieval + generation
make eval-quick     # same, retrieval only — no model tokens
make eval-project   # only the Learning Agent set
```

Non-zero exit on a failed gate, so it works unchanged as a CI step.

## Two datasets, scored separately

| File | Corpus | Role |
|---|---|---|
| `eval/golden/incidents.json` | Seeded runbooks and postmortems | **Control.** If its numbers move when you index something new, the new corpus is interfering. |
| `eval/golden/learning-agent.json` | The ISC-UPB/Learning-Agent repository | The corpus the demo actually answers about. |

`--dataset` is repeatable and defaults to every file in `eval/golden/`. Each is
gated on its own and the run fails if any dataset fails. Averaging two corpora
into one number hides which of them regressed, which is the only question worth
asking after a change.

## Why it exists

Every knob in this system — the embedding model, `MIN_CONTEXT_SCORE`, the RRF
weights, an edited prompt — changes answer quality in a direction nobody can
see by asking one question and reading the reply. Without a scored run, "it
seems better" is the entire quality process.

It became necessary the moment prompts became editable. An editable prompt is a
button for degrading the system silently, and the four anti-hallucination layers
cannot catch a prompt that is merely *worse* — only one that is malformed.

## What it measures

### Retrieval — no model calls beyond embedding the query

recall@k, MRR, precision@1 against documents named by hand as relevant in
`eval/golden/incidents.json`. This is where a regression from a chunking or
fusion change shows up first, and it is cheap enough to run on every commit.

### Calibration — the part that replaces a guess with a number

The confidence of answerable questions against the confidence of unanswerable
ones, reported as two distributions and the gap between them:

```
"calibration": {
  "answerable_min": 0.5308,
  "unanswerable_max": 0.4273,
  "gap": 0.1035,
  "suggested_threshold": 0.479
}
```

**The abstention threshold belongs in that gap.** This is the only output that
says where the gap actually is.

It found a real miscalibration on its first run. `MIN_CONTEXT_SCORE` was 0.35,
chosen by looking at a handful of scores by hand. The measured ceiling for
unanswerable questions is 0.427 — so three of four out-of-corpus questions,
including *"What was the root cause of INC-9999?"*, sailed past the gate and
reached the model.

They were answered correctly anyway ("The passages do not contain information
about…"), because layer 2 held. But that is the model choosing to behave, not
the guarantee the gate is supposed to provide. At 0.48 the gate fires and the
model is never called: 12/12 abstention decisions correct.

A negative gap is a failed gate, and it means something worse than a bad
threshold — it means no threshold separates the two classes and abstention
cannot work on confidence alone.

### Generation

Groundedness verdicts, whether citations point at the documents that were meant
to be cited, and `must_mention`: required facts that have to survive into the
answer. That last one exists because a paraphrase that drops a threshold — "roll
back quickly" for "2% for 5 minutes" — scores as perfectly grounded and is
useless during an incident.

## Case fields

| Field | Meaning |
|---|---|
| `query` | Written as a person would ask it, not copied from the document — copying tests string matching, not retrieval |
| `relevant` | Document ids that should be retrieved. Drives recall@k, MRR, precision@1 |
| `relevant_any` | The listed documents are interchangeable; retrieving any one scores full recall. For genuine near-duplicates — this corpus has two `init_rbac` migrations creating the same tables, and demanding both would score a correct answer as a miss |
| `must_mention` | Facts that must survive into the answer. A list nested inside it means any-of, for phrasings that are equally correct |
| `min_citations` | The answer must draw on at least this many distinct documents. Written for conflict cases: naming both values while citing one source is not reporting a conflict |
| `should_abstain` | The corpus cannot support an answer; refusing is the correct outcome |
| `collections` | Scope the query, so a question about one corpus is not answered from another |

## The seeded set

`eval/golden/incidents.json`. Twelve cases; the interesting ones are adversarial
by design:

- **`pool-before-scaling`** — the obvious action (scale the API) is the wrong
  one, and INC-2481 is 42 minutes of evidence that it does not help.
- **`redis-flushall-warning`** — a prohibition. Retrieval that finds the
  document but generation that inverts the advice is the failure being tested.
- **`oov-oncall-rota`** — names a service that *is* in the corpus, so retrieval
  returns something. The confidence gate has to reject it anyway.
- **`oov-invented-incident`** — "What was the root cause of INC-9999?" looks
  exactly like a corpus document id. Tests that lexical similarity to the id
  format does not manufacture confidence.

Add a case whenever a real question is answered badly. That is what keeps the
set honest — a golden set written entirely up front tests the questions you
thought of, not the ones that broke.

## The Learning Agent set

`eval/golden/learning-agent.json`. Fifteen cases over 33 Markdown and Prisma SQL
documents. Questions are in **English while the documents are Spanish** — on
purpose, because every question carries an exact identifier from its source
(`learning-agent`, `stop-forward`, `DocumentStatus`, `pg_isready`). Those tokens
are language-neutral, so the lexical branch still contributes and the hybrid
half of the system stays exercised.

Three kinds of case, and the conflict ones are new:

**Exact-identifier recall.** The namespace is `learning-agent` with a hyphen
while the database is `learning_agent` with an underscore, in the same document.
The MinIO console is on 9090, not the 9001 that MinIO itself defaults to — so a
model reaching for general knowledge instead of the passage is confidently wrong.

**Conflict cases.** This corpus contradicts itself: two different passwords for
the same database user, `pg16` versus `pg15` for the pgvector image, port 3000
as the NestJS backend versus as `json-server`. The password case asserts on
truncated prefixes (`app_pa`, `secure_`) rather than the full values — a test
fixture is a poor place to keep a credential copied out of another repository,
and substring matching makes the shorter form just as strict.
The generator prompt already says *"If passages disagree, say so and cite both"*,
and the seeded corpus is internally consistent so that instruction had never been
tested. These cases assert both values appear **and** that `min_citations: 2` is
met.

> These cases expire if the documents are fixed — and fixing them is the better
> outcome. A future reader should retire a conflict case because the
> contradiction is gone, not delete it because it fails.

**Abstention on adjacent content.** `oov-ingress-host` is the hardest: the word
`ingress` *does* appear, named once as an alternative to port-forwarding, so
retrieval returns a strong match and confidence stays high — but no manifest or
host exists. `oov-k8s-rollback` is worse still, and is what produced the finding
below.

## Gates

| Gate | Threshold | Why |
|---|---|---|
| `recall@k` | ≥ 0.8 | Below this, generation quality is irrelevant — the passages are not there |
| confidence gap | > 0 | A non-positive gap means abstention cannot work |
| false answers | 0 | Answering a question the corpus cannot support is the failure this system exists to prevent |
| false abstentions | 0 | A gate that refuses answerable questions is worse than no gate — nobody keeps using it |
| `groundedness_mean` | ≥ 0.7 | |
| dropped facts | none | |
| under-cited | none | A case requiring several citations asserts that conflicting documents were *both* surfaced |

## Current baseline

`text-embedding-3-large` @ 512 dims, `gpt-4o`, `MIN_CONTEXT_SCORE=0.48`,
reranking disabled.

**Seeded corpus** — all gates pass:

```
recall@k 1.0 · MRR 0.85 · precision@1 0.75
abstention 12/12 · groundedness 1.0 · no dropped facts
```

**Learning Agent corpus** — three gates fail, and every failure is a real
property of the system rather than a mis-written case:

```
recall@k 0.96 · MRR 0.85 · precision@1 0.75 · groundedness 1.0
calibration gap  -0.09     ← negative
conflicts reported  0 of 3
```

Re-derive the threshold whenever the embedding model or the corpus changes.
Both move the distributions, and a stale threshold fails silently in the
expensive direction: out-of-corpus questions reach the model.

## What the Learning Agent set found

### 1. A negative calibration gap — cosine cannot tell "undo" from "delete"

The highest-scoring *unanswerable* question (0.520) outscores the lowest-scoring
*answerable* one (0.428). No threshold separates them.

The mechanism is worth understanding, because it is not a tuning problem.
*"How do I roll back a bad deployment?"* retrieves the **cleanup** section —
`./deploy.sh cleanup`, `kubectl delete namespace`. In embedding space, undoing a
deployment and deleting a deployment are neighbours. Operationally they are
opposites, and one of them is catastrophic.

Cosine similarity measures topical proximity. It cannot measure whether a
passage *answers* the question, which is precisely what the abstention gate
needs.

At the other end, `document-status-enum` scores 0.428 because it is raw SQL
(`CREATE TYPE … AS ENUM`) matched against an English prose question. SQL does not
sit near prose in embedding space, so a correct, retrievable answer looks weak.

### 2. Contradictions are not reported

All three conflict cases failed identically: one source cited, the second value
dropped. For two of them **both documents were retrieved** — so the model saw the
disagreement and picked a side silently.

The generator prompt instructs otherwise: *"If passages disagree, say so and cite
both."* That instruction is not being followed, and until this set existed there
was no way to know, because the seeded corpus never contradicts itself.

### 3. The LLM reranker improves ranking but cannot gate

Tested with `RERANK_PROVIDER=llm`:

| | cosine only | LLM rerank |
|---|---|---|
| MRR | 0.854 | **0.958** |
| precision@1 | 0.75 | **0.917** |
| calibration gap | −0.092 | −0.020 |

Better ranking, still no usable gate — for two reasons. Its prompt offers three
anchor values (1.0, 0.5, 0.0) and the model emits exactly those, so the scale is
categorical rather than continuous. And it is **nondeterministic**: the same
conflict cases scored 1.0 in one run and abstained in the next, which makes the
abstention decision itself unstable.

Note that 0.5 is defined as *"same system or symptom, but does not resolve the
question"* — the correct verdict for an adjacent-but-unanswerable question. The
judgement is right; the resolution is too coarse to threshold on.

**The untested option is a real cross-encoder** (`RERANK_PROVIDER=voyage` or
`cohere`), which returns a calibrated continuous relevance score. That is the
principled fix for a negative gap and it needs a vendor key this project does not
currently have.

## Honest limits

The seeded set is nine documents and twelve questions. Recall of 1.0 on a corpus
that size says retrieval is not broken — it does not say it scales. Recall fell
the moment a second corpus was indexed, which is competition working as expected
rather than a regression.

**The Learning Agent set currently fails, and it is being left failing.** Every
failure traces to a real property — cosine's inability to separate "undo" from
"delete", and a prompt instruction the model is not honouring. Moving
`MIN_CONTEXT_SCORE` until the numbers turn green would silence the measurement
without changing the behaviour, which is the exact failure mode this harness
exists to prevent. A red gate that names a real defect is worth more than a
green one that was tuned into place.

Two abstention cases rest on a judgement rather than a keyword count.
`oov-ingress-host` and `oov-k8s-rollback` name topics the corpus *mentions*
without documenting. If a future change makes the model answer them sensibly
from surrounding context, the right response is to reword the question — not to
move the threshold.
