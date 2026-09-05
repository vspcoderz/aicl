#!/usr/bin/env node
/**
 * Extract UNSEEN eval lines from the full HF corpus on the VPS.
 *
 * A line counts as unseen iff it does not appear in the training sample
 * (sample_raw.txt). Lines are classified by heuristic (english/code/sql/
 * markdown) and N per domain are written to unseen_eval.json.
 * Benchmark texts are excluded by fingerprint to avoid contamination.
 *
 * Usage: node extract_unseen.mjs <corpus> <sample> <out.json> [perDomain=150]
 */
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const [corpus, sample, out] = process.argv.slice(2);
const PER = Number(process.argv[5] ?? process.argv[4] ?? 150);

// Fingerprints of the 8 benchmark texts + boost collocation sentences.
const CONTAM = [
  'quick brown fox', 'rain in spain', 'emergency broadcast', 'brown cow',
  'express()', 'app.get(', 'created_at DESC', 'PRIMARY KEY,name',
  'john@example.com', 'per_page', 'Hello, World!', 'hyprland.conf',
  'git@host:user', 'aicl is Goated',
];

const isCode = (l) =>
  /^\s*(def |function |class |const |let |var |import |from |export |return |if\s*\(|for\s*\(|while\s*\(|elif |print\(|@)\b/.test(l) ||
  /=>|;\s*$|\{\s*$|^\s+\}|^\s*[a-z_][\w.]*\(/.test(l);
const isSql = (l) =>
  /\b(SELECT|INSERT INTO|CREATE TABLE|UPDATE\s+\w+\s+SET|DELETE FROM|ALTER TABLE|GROUP BY|ORDER BY)\b/.test(l);
const isMarkdown = (l) =>
  /^#{1,6} /.test(l) || /^\s*[-*+]\s/.test(l) || /^\|/.test(l) ||
  /\*\*[^*]{2,}\*\*/.test(l) || /^>\s/.test(l) || /^```/.test(l);

function classify(l) {
  if (isSql(l)) return 'sql';
  if (isMarkdown(l)) return 'markdown';
  if (isCode(l)) return 'code';
  return 'english';
}

const usable = (l) => {
  if (l.length < 60 || l.length > 2000) return false;
  let nonAscii = 0;
  for (const c of l) if (c.codePointAt(0) > 127) nonAscii++;
  return nonAscii / l.length < 0.02 && !CONTAM.some((f) => l.includes(f));
};

// Load training-sample lines for exclusion.
console.error('loading sample…');
const seen = new Set();
{
  const rl = createInterface({ input: createReadStream(sample), crlfDelay: Infinity });
  for await (const line of rl) seen.add(line);
}
console.error(`sample lines loaded: ${seen.size}`);

const buckets = { english: [], code: [], sql: [], markdown: [] };
const rl = createInterface({ input: createReadStream(corpus), crlfDelay: Infinity });
let n = 0;
for await (const line of rl) {
  n++;
  if (seen.has(line)) continue;
  if (!usable(line)) continue;
  const d = classify(line);
  if (buckets[d].length < PER) buckets[d].push(line);
}
console.error(`corpus lines: ${n}`);

const counts = {};
for (const [d, lines] of Object.entries(buckets)) {
  counts[d] = lines.length;
  // deterministic shuffle
  for (let i = lines.length - 1; i > 0; i--) {
    const j = (i * 2654435761) % (i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
}
writeFileSync(out, JSON.stringify(buckets, null, 1));
console.log('extracted:', JSON.stringify(counts));
