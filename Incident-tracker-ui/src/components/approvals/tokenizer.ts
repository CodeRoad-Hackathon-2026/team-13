import type { ReactNode } from "react";
import { createElement } from "react";

// research.md §8: a small hand-written tokenizer producing React elements, never
// dangerouslySetInnerHTML (Principle XIII). Covers JSON punctuation/strings/numbers/literals and
// the handful of SQL keywords sql-formatter's pretty-printed output actually contains.
const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*)|(\b(?:true|false|null|SELECT|FROM|WHERE|UPDATE|SET|INSERT|INTO|VALUES|DELETE|AND|OR|JOIN|ON|ORDER|BY|LIMIT|GROUP)\b)|([{}[\]:,()])/gi;

export type TokenKind = "string" | "number" | "keyword" | "punctuation" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

function classify(match: RegExpExecArray): TokenKind {
  if (match[1] !== undefined) return "string";
  if (match[2] !== undefined) return "number";
  if (match[3] !== undefined) return "keyword";
  if (match[4] !== undefined) return "punctuation";
  return "plain";
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(TOKEN_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), kind: "plain" });
    }
    tokens.push({ text: match[0], kind: classify(match) });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), kind: "plain" });
  }
  return tokens;
}

export function renderHighlighted(text: string): ReactNode[] {
  return tokenize(text).map((token, i) =>
    token.kind === "plain" ? token.text : createElement("span", { key: i, "data-token": token.kind }, token.text),
  );
}
