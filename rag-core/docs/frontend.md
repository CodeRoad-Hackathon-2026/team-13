# Frontend

A React + Vite SPA. In production FastAPI serves the built bundle, so there is one container and one origin.

```
frontend/
  src/
    api/client.ts     typed client for every /v1 endpoint
    api/stream.ts     SSE-over-POST reader
    api/types.ts      wire types mirroring app/schemas.py
    components/       ApiKeyGate, SourceCard, ScoreBars, badges, FilterBuilder
                      ConnectorForm — renders a form from the backend's field schema
    screens/          Ask · Search · Corpus · Setup · Metrics
```

Dependencies are deliberately few: `react`, `react-dom`, `react-router-dom`, `react-markdown`. No UI kit, no state library — hand-written CSS with variables, and small fetch hooks.

## Running it

```bash
# production shape: the API serves the built bundle
cd frontend && npm install && npm run build
# → http://localhost:8000

# hot reload
docker compose --profile dev up frontend
# → http://localhost:5173  (proxies /v1 to the api container)
```

The Vite dev server proxies `/v1`, so the browser sees a single origin and CORS never enters the picture — dev matches production instead of diverging from it.

## Screens

### Ask

The screen that shows the guardrails working. Sources render from the `sources` event **before** the first token, the answer streams in, and `[n]` markers become chips that scroll to and highlight the matching source card.

On `final`: confidence, groundedness verdict, model, latency, and any `warnings` — including citation markers that were stripped because they pointed at passages the model was never given.

Abstention gets its own banner, worded as a deliberate outcome rather than an error, because that is what it is.

Thumbs up/down per source posts to `/feedback` with both `query_log_id` and `chunk_id`, which is what makes the rating count toward ranking.

### Search

Retrieval only — no LLM tokens. Each result shows a four-bar score breakdown (vector / lexical / RRF / rerank) and a `hybrid | vector | lexical` badge, plus a summary count by mode.

This exists to make a specific silent failure visible: if every result says `vector`, the lexical branch has stopped contributing and hybrid search has degraded without erroring. See [decisions.md](decisions.md#the-lexical-branch-ors-its-lexemes).

### Setup

Four tabs, all documented in [setup.md](setup.md).

The one structural idea: **`ConnectorForm` renders whatever `GET /v1/source-types` describes.** No screen knows what Slack or Jira need. Adding a connector adds its form, with no frontend change and no way for the form and the code reading the config to drift apart.

Two smaller decisions worth keeping:

- A `secret` field renders a **picker over stored secret names**, not a text box. A text box invites pasting the literal token into a config that `GET /v1/sources` hands to every reader.
- Optional values are **deleted** from the config rather than stored as `undefined`. Otherwise every untouched field persists as `null` and the connector cannot tell "unset" from "explicitly empty".

### Corpus

Collections with counts and embedding model. Sources with `last_status`, `last_error` and a **Sync now** button. A paste-a-document form that polls `/jobs/{id}` until the job settles.

### Metrics

`/admin/stats` cards — queries, abstention rate, average groundedness, latency, feedback — plus the resolved providers from `/health`, and a trace viewer for `/traces/{id}` that deep-links via `?trace=`.

A non-zero abstention rate is surfaced as healthy, because it is: it means the confidence gate is firing.

The trace viewer can **pin**, which exempts a trace from retention pruning. Pin any trace a PR body links to for its justification — otherwise the link dies after thirty days while the PR lives in git forever. It also badges any prompt whose version is above 1, so an answer produced by an edited prompt is visibly not one produced by the shipped default.

## Consuming the SSE stream

**`EventSource` cannot be used.** It only issues GET requests, and `/v1/answer/stream` is a POST carrying the query, filters and collections. `src/api/stream.ts` reads the response body and parses SSE frames itself.

The detail that breaks naive implementations: **a network chunk is not a frame**. One `reader.read()` can deliver half a frame or three at once, so the tail must be buffered until a blank line actually arrives.

```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";          // keep the partial frame
  for (const frame of frames) handle(parseFrame(frame));
}
```

Splitting each chunk independently silently drops text mid-answer — and it looks like a model problem, not a parsing one.

### Events

| Event | Payload | Meaning |
|---|---|---|
| `sources` | `{sources: SearchResult[]}` | Retrieved passages, before generation |
| `delta` | `{text}` | Token chunk — **unverified** |
| `abstained` | `AnswerResponse` | Gate fired; no generation happened |
| `final` | `AnswerResponse` | Validated: citations resolved, judge run |
| `done` | `{query_log_id}` | Stream complete |
| `error` | `{message}` | Generation failed |

**`final` is the event to trust.** Deltas are unverified by construction: citation validation and the groundedness judge run on the assembled answer. A client that renders deltas and ignores `final` has opted out of the guardrails.

## API key handling

The key lives in `localStorage` behind a gate that blocks the app until it is set, and is sent as `X-API-Key` on every request.

Stated plainly in the UI and here: **a key held in the browser is visible to whoever holds the browser.** That is fine for a demo or an internal tool. A public deployment needs a session-cookie BFF where the key never reaches the client — obfuscating it client-side would be theatre.

## Serving in production

`app/main.py` mounts the built bundle at `/`, after `include_router`, so `/v1` and `/docs` keep priority. Two details are load-bearing:

- **SPA fallback**: `StaticFiles` *raises* `HTTPException(404)` rather than returning a 404 response, so the fallback has to catch. Checking `response.status_code` never fires, and reloading on `/search` 404s.
- **The fallback must not swallow API 404s**: paths under `v1/` re-raise. Otherwise a typo'd endpoint answers with HTML and status 200, which is miserable to debug from a client.

If `frontend/dist` does not exist the API still starts and `/` returns JSON pointing at `/docs`.

## Adding a screen

1. Add the endpoint to `src/api/client.ts` and its types to `src/api/types.ts`.
2. Create `src/screens/Name.tsx`.
3. Register the route and tab in `src/App.tsx`.

`npm run typecheck` catches contract drift between the client types and the screens — but not between the types and the actual API, which is why `app/schemas.py` remains the source of truth.
