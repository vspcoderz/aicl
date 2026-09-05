#!/usr/bin/env node
/**
 * Fast incremental BPE trainer — drop-in equivalent of trainTokenizer().
 *
 * The reference trainer recomputes pair counts over the entire corpus for
 * every merge (O(numMerges * corpusLen)). This one updates counts in place
 * around each merged occurrence (O(corpusLen) total), producing the exact
 * same merge sequence: same counting rule (pairs whose combined PUA length
 * exceeds maxTokenLength are skipped) and same tie-break (highest count,
 * then lexicographically smallest pair key).
 */
export function trainTokenizerFast(aiclCorpus, opts = {}) {
  const numMerges = opts.numMerges ?? 4096;
  const mergeBase = opts.mergeBase ?? 100000;
  const maxTokenLen = opts.maxTokenLength ?? 5;
  const minFreq = opts.minFrequency ?? 2;

  const cpToId = (ch) => 0x1000000 + ch.codePointAt(0);
  const seqs = aiclCorpus.map((t) => Array.from(t, cpToId));
  const merges = new Map();
  const tokenLen = new Map(); // id -> PUA length (immutable per id)
  const pairCounts = new Map(); // 'a:b' -> count

  const addPair = (a, b, d) => {
    // token lengths are immutable, so the length filter outcome for a pair
    // never changes and increment/decrement always agree on the filter
    if ((tokenLen.get(a) ?? 1) + (tokenLen.get(b) ?? 1) > maxTokenLen) return;
    const k = a + ':' + b;
    const c = (pairCounts.get(k) || 0) + d;
    if (c > 0) pairCounts.set(k, c);
    else pairCounts.delete(k);
  };

  for (const seq of seqs) {
    for (let i = 0; i < seq.length - 1; i++) addPair(seq[i], seq[i + 1], 1);
  }

  const pickBest = () => {
    let bestKey = null;
    let bestCount = 0;
    for (const [k, count] of pairCounts) {
      if (count < minFreq) continue;
      if (count > bestCount || (count === bestCount && (bestKey === null || k < bestKey))) {
        bestCount = count;
        bestKey = k;
      }
    }
    if (bestKey === null || bestCount < minFreq) return null;
    const sep = bestKey.indexOf(':');
    return [Number(bestKey.slice(0, sep)), Number(bestKey.slice(sep + 1))];
  };

  for (let m = 0; m < numMerges; m++) {
    const best = pickBest();
    if (!best) break;
    const [a, b] = best;
    const mergedId = mergeBase + merges.size;
    merges.set(mergedId, { a, b, rank: merges.size });
    tokenLen.set(mergedId, (tokenLen.get(a) ?? 1) + (tokenLen.get(b) ?? 1));

    for (let s = 0; s < seqs.length; s++) {
      const seq = seqs[s];
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
      seqs[s] = next;
    }
  }

  return { merges, mergeBase, numMerges: merges.size, version: '1.0', maxTokenLength: maxTokenLen };
}
