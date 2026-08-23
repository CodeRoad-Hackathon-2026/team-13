#!/usr/bin/env bash
# Parse every Mermaid block in docs/ so a broken diagram is never committed.
#
#   ./scripts/validate_diagrams.sh
#
# Runs mermaid's own parser inside a throwaway node container, with a jsdom DOM
# so DOMPurify initializes. mermaid-cli is not used: it needs headless Chrome,
# which cannot launch under Rosetta on Apple Silicon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$ROOT" "$WORK" <<'PY'
import pathlib, re, sys
root, work = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
count = 0
for f in sorted(root.joinpath("docs").rglob("*.md")):
    for i, m in enumerate(re.finditer(r"```mermaid\n(.*?)```", f.read_text(), re.S)):
        rel = f.relative_to(root).as_posix().replace("/", "__")
        work.joinpath(f"{rel}__{i}.mmd").write_text(m.group(1))
        count += 1
print(f"extracted {count} mermaid blocks")
PY

cat > "$WORK/validate.js" <<'JS'
import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;

const mermaid = (await import('mermaid')).default;
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });

let fail = 0;
for (const f of fs.readdirSync('/data').filter(f => f.endsWith('.mmd')).sort()) {
  try {
    await mermaid.parse(fs.readFileSync(path.join('/data', f), 'utf8'));
    console.log('OK   ' + f);
  } catch (e) {
    fail++;
    console.log('FAIL ' + f + '\n       ' +
      String(e?.message ?? e).split('\n').slice(0, 6).join(' | '));
  }
}
console.log(fail ? `\n${fail} diagram(s) failed` : '\nall diagrams parse');
process.exit(fail ? 1 : 0);
JS

docker run --rm \
  -v "$WORK:/data" \
  -v "$WORK/validate.js:/app/validate.js" \
  -w /app node:22-alpine \
  sh -c 'npm init -y >/dev/null 2>&1 \
      && npm pkg set type=module >/dev/null 2>&1 \
      && npm i mermaid@11 jsdom --silent >/dev/null 2>&1 \
      && node validate.js'
