/**
 * SSE over POST.
 *
 * `EventSource` cannot be used here: it only issues GET requests, and
 * /v1/answer/stream is a POST carrying the query, filters and collections.
 * So we read the response body ourselves and parse SSE frames by hand.
 *
 * The parsing detail that matters: a network chunk is not a frame. A single
 * read can deliver half a frame, or three frames at once, so the tail of each
 * chunk is buffered until a blank line (frame terminator) actually arrives.
 * Splitting each chunk independently silently drops text mid-answer.
 */

import { authHeaders } from "./client";
import type { AnswerResponse, SearchResult } from "./types";

export type StreamEvent =
  | { event: "sources"; data: { sources: SearchResult[] } }
  | { event: "delta"; data: { text: string } }
  | { event: "abstained"; data: AnswerResponse }
  | { event: "final"; data: AnswerResponse }
  | { event: "done"; data: { query_log_id: string | null } }
  | { event: "error"; data: { message: string } };

export interface StreamAnswerParams {
  query: string;
  collections?: string[] | null;
  filters?: Record<string, string>;
  top_k?: number;
  incident_id?: string;
  signal?: AbortSignal;
}

function parseFrame(frame: string): StreamEvent | null {
  let name = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      name = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // Per the SSE spec exactly one leading space is stripped.
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // ":" comment lines and unknown fields are ignored.
  }

  if (dataLines.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(dataLines.join("\n")) } as StreamEvent;
  } catch {
    return null;
  }
}

export async function* streamAnswer(
  params: StreamAnswerParams,
): AsyncGenerator<StreamEvent> {
  const { signal, ...body } = params;

  const response = await fetch("/v1/answer/stream", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ top_k: 8, ...body }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = response.statusText;
    try {
      detail = (await response.json()).detail ?? detail;
    } catch {
      /* keep status text */
    }
    yield { event: "error", data: { message: `${response.status}: ${detail}` } };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Keep the trailing partial.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    // A final frame with no trailing blank line still counts.
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.cancel().catch(() => {});
  }
}
