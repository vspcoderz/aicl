#!/usr/bin/env node
/**
 * Fast incremental BPE trainer.
 *
 * Two operating modes:
 *  - default: drop-in equivalent of trainTokenizer() (verified byte-identical)
 *  - aliasTrailingSpace: pre-pass deterministically fuses every
 *    (symbol, MOD_TRAIL_SPACE) adjacency into one alias token before BPE
 *    learning. Because pair merges are keyed by specific symbol IDs, a pure
 *    BPE can only cover numMerges (word+space) combos — aliasing covers ALL
 *    of them for every symbol seen once, which is what makes unseen text
 *    compress. Alias rules are emitted first in the vocab (lowest ranks),
 *    learned collocation merges follow.
 *
 * Argmax is a linear scan over pairCounts (bounded by the PUA alphabet,
 * ~1.3M pair types max — a heap's memory cost outweighs the scan).
 */
const CP_BASE = 0x1000000;
const ALIAS_FLAG = 0x40000000; // synthetic alias ids: 0x40000000 + codePoint, int32-safe

export function trainTokenizerFast(aiclCorpus, opts = {}) {
  const numMerges = opts.numMerges ?? 4096;
  const mergeBase = opts.mergeBase ?? 100000;
  const maxTokenLen = opts.maxTokenLength ?? 5;
  const minFreq = opts.minFrequency ?? 2;
  const aliasTSp = opts.aliasTrailingSpace === true;
  // The encoder emits inter-word spaces in TWO forms: the ' ' dictionary
  // symbol (U+100406) and the MOD_TRAIL_SPACE modifier (U+100801). Both must
  // be aliased or the un-aliased form's (word, space) pairs eat the merge
  // budget. Two disjoint synthetic-id ranges keep training ids unique.
  const tspCps = opts.trailingSpaceCodePoints ??
    (opts.trailingSpaceCodePoint ? [opts.trailingSpaceCodePoint] : [0x100801]);
  const tspIds = tspCps.map((c) => CP_BASE + c);
  const ALIAS_FLAG2 = 0x41000000; // form-1 alias ids: 0x41000000 + codePoint
  const ALIAS_LIMIT = 0x42000000;
  const aliasFlagOf = (formIdx) => (formIdx === 0 ? ALIAS_FLAG : ALIAS_FLAG2);
  // Learn merges on an interleaved subset (aliases still cover the FULL
  // corpus). Keeps merge-loop cost flat on huge corpora while preserving
  // stratification across corpus blocks.
  const learnEvery = opts.learnEvery ?? 1;
  // Real-text corpora contain whitespace runs (double spaces, code indent)
  // whose (ws,ws) pairs self-merge forever — (SP,SP)->S2, (S2,S2)->S4, ...
  // burning the whole merge budget. Learned merges skip them; aliases are
  // unaffected. Off by default so non-alias mode stays reference-identical.
  const skipDegenerate = opts.skipDegeneratePairs === true;
  const isWsId = (id) =>
    id === CP_BASE + 0x20 || id === CP_BASE + 0x09 || id === CP_BASE + 0x0a ||
    id === CP_BASE + 0x100406 /* space symbol */ ||
    id === CP_BASE + 0x100801 /* MOD_TRAIL_SPACE */;

  const cpToId = (ch) => CP_BASE + ch.codePointAt(0);
  const seqs = aiclCorpus.map((t) => Array.from(t, cpToId));

  // ── alias pre-pass: (X, any-space-form) -> aliasId(X, form) ──
  const aliasFreq = new Map(); // 'cp:form' -> occurrences
  if (aliasTSp) {
    for (const seq of seqs) {
      let w = 0;
      for (let i = 0; i < seq.length; i++) {
        const nxt = i + 1 < seq.length ? seq[i + 1] : -1;
        const form = tspIds.indexOf(nxt);
        if (form !== -1 && !tspIds.includes(seq[i])) {
          const cp = seq[i] - CP_BASE;
          const key = cp + ':' + form;
          aliasFreq.set(key, (aliasFreq.get(key) || 0) + 1);
          seq[w++] = aliasFlagOf(form) + cp;
          i++;
        } else {
          seq[w++] = seq[i];
        }
      }
      seq.length = w;
    }
  }

  const merges = new Map(); // mergedId -> {a, b, rank}
  const tokenLen = new Map(); // id -> PUA length (immutable per id)
  const pairCounts = new Map(); // 'a:b' -> count

  // aliases first, most frequent symbol first (deterministic ranks)
  const aliasList = [...aliasFreq.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  const aliasMergedId = new Map(); // 'cp:form' -> runtime mergedId
  for (const [key] of aliasList) {
    const sep = key.lastIndexOf(':');
    const cp = Number(key.slice(0, sep));
    const form = Number(key.slice(sep + 1));
    const id = mergeBase + merges.size;
    merges.set(id, { a: CP_BASE + cp, b: CP_BASE + tspCps[form], rank: merges.size, alias: true });
    tokenLen.set(id, 2);
    aliasMergedId.set(key, id);
  }

  // ── alias translation: rewrite synthetic alias ids in the sequences to
  // their runtime merged ids. Learned merges then count/scan/emit real ids —
  // without this, the merge scan can never match an alias pair, its count
  // never decrements, and pickBest() re-emits the same top pair forever. ──
  // learnSeqs is built AFTER translation so counts, scans and emitted rules
  // all share the runtime id space.
  let learnSeqs = null;
  if (aliasTSp) {
    for (const seq of seqs) {
      for (let i = 0; i < seq.length; i++) {
        const id = seq[i];
        if (id >= ALIAS_FLAG && id < ALIAS_LIMIT) {
          const form = id >= ALIAS_FLAG2 ? 1 : 0;
          seq[i] = aliasMergedId.get((id - (form ? ALIAS_FLAG2 : ALIAS_FLAG)) + ':' + form);
        }
      }
    }
  }
  learnSeqs = learnEvery > 1 ? seqs.filter((_, i) => i % learnEvery === 0) : seqs;

  const addPair = (a, b, d) => {
    if (skipDegenerate && d > 0 && (a === b || (isWsId(a) && isWsId(b)))) return;
    if ((tokenLen.get(a) ?? 1) + (tokenLen.get(b) ?? 1) > maxTokenLen) return;
    const k = a + ':' + b;
    const c = (pairCounts.get(k) || 0) + d;
    if (c > 0) pairCounts.set(k, c);
    else pairCounts.delete(k);
  };

  // ── argmax: linear scan over pairCounts (bounded by the PUA alphabet,
  // ~1.3M pair types max — a heap's memory cost outweighs the scan) ──
  function pickBest() {
    let bestKey = null;
    let bestCount = 0;
    for (const [k, count] of pairCounts) {
      if (count < minFreq) continue;
      if (count > bestCount || (count === bestCount && (bestKey === null || k < bestKey))) {
        bestCount = count;
        bestKey = k;
      }
    }
    return bestCount >= minFreq ? bestKey : null;
  }

  for (const seq of learnSeqs) {
    for (let i = 0; i < seq.length - 1; i++) addPair(seq[i], seq[i + 1], 1);
  }

  for (let m = 0; m < numMerges; m++) {
    const bestKey = pickBest();
    if (bestKey === null) break;
    const sep = bestKey.indexOf(':');
    const a = Number(bestKey.slice(0, sep));
    const b = Number(bestKey.slice(sep + 1));
    const mergedId = mergeBase + merges.size;
    merges.set(mergedId, { a, b, rank: merges.size });
    tokenLen.set(mergedId, (tokenLen.get(a) ?? 1) + (tokenLen.get(b) ?? 1));

    for (let s = 0; s < learnSeqs.length; s++) {
      const seq = learnSeqs[s];
      const next = [];
      let prev = -1; // last token written to `next`
      let j = 0;
      while (j < seq.length) {
        if (j < seq.length - 1 && seq[j] === a && seq[j + 1] === b) {
          // pairs (prev,a), (a,b), (b,next) die; (prev,merged), (merged,next) born.
          // When the following token starts another occurrence, its
          // (prev,a) decrement cancels the (merged,next) increment below.
          if (prev !== -1) addPair(prev, a, -1);
          if (j + 2 < seq.length) addPair(b, seq[j + 2], -1);
          addPair(a, b, -1);
          if (prev !== -1) addPair(prev, mergedId, 1);
          next.push(mergedId);
          prev = mergedId;
          if (j + 2 < seq.length) addPair(mergedId, seq[j + 2], 1);
          j += 2;
          continue;
        }
        next.push(seq[j]);
        prev = seq[j];
        j++;
      }
      // learnSeqs aliases the (possibly shared) seqs arrays; when
      // learnEvery===1 they are the same array, so this write covers both.
      learnSeqs[s] = next;
    }
  }

  return { merges, mergeBase, numMerges: merges.size, version: '1.1', maxTokenLength: maxTokenLen, aliases: aliasFreq.size };
}
