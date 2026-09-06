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
 * Resume mode (initMerges): seeds the merge table with a prior vocab (its
 * alias rules). numMerges then counts TOTAL rules; the trainer re-fuses
 * (symbol, space-form) adjacencies directly into the prefix's runtime alias
 * ids and only LEARNS the remaining merges. Used for checkpoint-resume on
 * the VPS where a host-level kill can reap the process without a trace.
 *
 * Argmax is a linear scan over pairCounts (bounded by the PUA alphabet,
 * ~1.3M pair types max — a heap's memory cost outweighs the scan).
 */
const CP_BASE = 0x1000000;

export function trainTokenizerFast(aiclCorpus, opts = {}) {
  const numMerges = opts.numMerges ?? 4096;
  const mergeBase = opts.mergeBase ?? 100000;
  const maxTokenLen = opts.maxTokenLength ?? 5;
  const minFreq = opts.minFrequency ?? 2;
  const aliasTSp = opts.aliasTrailingSpace === true;
  // The encoder emits inter-word space in MANY forms: the ' ' dictionary
  // symbol (U+100406), the MOD_TRAIL_SPACE modifier (U+100801) and the
  // space-run dict symbols (2..7, 8, 12, 16 spaces). Every form a word can
  // be followed by needs aliasing, or un-aliased (word, space) pairs eat the
  // merge budget. Alias flag ranges: 0x40000000 + formIdx * 0x1000000 + cp.
  const tspCps = opts.trailingSpaceCodePoints ??
    [0x100406, 0x100801, 0x10ae54, 0x10ae55, 0x10ae56, 0x10ae57, 0x10ae58, 0x10ae72, 0x10ae73, 0x10ae74, 0x10ae75];
  const tspIds = tspCps.map((c) => CP_BASE + c);
  const ALIAS_FLAG = 0x40000000;
  const ALIAS_LIMIT = ALIAS_FLAG + tspCps.length * 0x1000000;
  const aliasFlagOf = (formIdx) => ALIAS_FLAG + formIdx * 0x1000000;
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
    id === CP_BASE + 0x100801 /* MOD_TRAIL_SPACE */ ||
    // space-run dict symbols (2/4/8/12/16 spaces, dict/symbols.json) — their
    // runs are already covered by the symbols themselves; (run,run) learned
    // merges would just burn budget the same way raw ws self-merges did
    (id >= CP_BASE + 0x10ae54 && id <= CP_BASE + 0x10ae58) ||
    (id >= CP_BASE + 0x10ae72 && id <= CP_BASE + 0x10ae75);

  const resume = Array.isArray(opts.initMerges) && opts.initMerges.length > 0;
  // Capitalized words emit (base, MOD_CAPS|MOD_ALLCAPS, space-form) triples —
  // without caps aliasing, every capitalized word costs 2-3 tokens while a
  // lowercase word costs 1. The pre-pass fuses the triple into ONE synthetic
  // token; at runtime it decomposes as (base) + alias(MOD,space). Flag space:
  // 0x42000000 + kind*0x400000 + form*0x200000 + cp  (kind 0=CAPS 1=ALLCAPS).
  const MOD_CAPS_CP = 0x100800, MOD_ALLCAPS_CP = 0x100811;
  const CAPS_FLAG = 0x50000000, CAPS_LIMIT = 0x58000000;
  const capsFlagOf = (kind, form, cp) => CAPS_FLAG + kind * 0x400000 + form * 0x200000 + cp;

  const cpToId = (ch) => CP_BASE + ch.codePointAt(0);
  const seqs = aiclCorpus.map((t) => Array.from(t, cpToId));

  const merges = new Map(); // mergedId -> {a, b, rank}
  const tokenLen = new Map(); // id -> PUA length (immutable per id)
  const pairCounts = new Map(); // 'a:b' -> count
  const aliasMergedId = new Map(); // 'cp:form' -> runtime mergedId
  const aliasFreq = new Map(); // 'cp:form' -> occurrences (fresh runs only)
  const capsMergedId = new Map(); // 'cp:kind:form' -> runtime mergedId
  const capsFreq = new Map(); // 'cp:kind:form' -> occurrences (fresh runs only)

  if (resume) {
    // Seed from a prior vocab. Entries are [id, {a, b, rank, alias}] in rank
    // order, so tokenLen of a learned rule can look up earlier merged ids.
    for (const [id, r] of opts.initMerges) {
      const rule = r && typeof r === 'object' ? r : { a: r[0], b: r[1], rank: r[2] };
      merges.set(id, { a: rule.a, b: rule.b, rank: rule.rank ?? merges.size, alias: rule.alias });
      tokenLen.set(id, (tokenLen.get(rule.a) ?? 1) + (tokenLen.get(rule.b) ?? 1));
      if (rule.alias && rule.a >= CP_BASE && !tspIds.includes(rule.a)) {
        const form = tspIds.indexOf(rule.b);
        if (form !== -1) aliasMergedId.set((rule.a - CP_BASE) + ':' + form, id);
      }
    }
  } else if (aliasTSp) {
    // ── alias pre-pass ──
    // (X, space-form) → aliasId(X, form), and
    // (X, MOD_CAPS|MOD_ALLCAPS, space-form) → capsAliasId(X, kind, form) so a
    // capitalized word tokenizes as one token exactly like a lowercase one.
    const isModCp = (cp) => cp === MOD_CAPS_CP || cp === MOD_ALLCAPS_CP;
    for (const seq of seqs) {
      let w = 0;
      let i = 0;
      while (i < seq.length) {
        const cur = seq[i];
        const nxt = i + 1 < seq.length ? seq[i + 1] : -1;
        const nxt2 = i + 2 < seq.length ? seq[i + 2] : -1;
        const cp = cur - CP_BASE;
        const pairForm = tspIds.indexOf(nxt);
        const modCp = nxt - CP_BASE;
        const tripleForm = tspIds.indexOf(nxt2);
        if (pairForm !== -1 && !tspIds.includes(cur)) {
          const key = cp + ':' + pairForm;
          aliasFreq.set(key, (aliasFreq.get(key) || 0) + 1);
          seq[w++] = aliasFlagOf(pairForm) + cp;
          i += 2;
        } else if (tripleForm !== -1 && isModCp(modCp) && !tspIds.includes(cur) && !isModCp(cp)) {
          const kind = modCp === MOD_ALLCAPS_CP ? 1 : 0;
          const key = cp + ':' + kind + ':' + tripleForm;
          capsFreq.set(key, (capsFreq.get(key) || 0) + 1);
          // the (MOD,space) pair inside the triple still needs its own alias
          // rule — it is the building block b of the emitted caps rule
          const mkey = modCp + ':' + tripleForm;
          aliasFreq.set(mkey, (aliasFreq.get(mkey) || 0) + 1);
          seq[w++] = capsFlagOf(kind, tripleForm, cp);
          i += 3;
        } else {
          seq[w++] = cur;
          i++;
        }
      }
      seq.length = w;
    }
    // aliases first, most frequent symbol first (deterministic ranks)
    const aliasList = [...aliasFreq.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    for (const [key] of aliasList) {
      const sep = key.lastIndexOf(':');
      const cp = Number(key.slice(0, sep));
      const form = Number(key.slice(sep + 1));
      const id = mergeBase + merges.size;
      merges.set(id, { a: CP_BASE + cp, b: CP_BASE + tspCps[form], rank: merges.size, alias: true });
      tokenLen.set(id, 2);
      aliasMergedId.set(key, id);
    }
    // caps aliases: (base, alias(MOD,space)) — one rule per (word, modifier,
    // space form) seen in the corpus, deterministic full coverage
    const capsList = [...capsFreq.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    for (const [key] of capsList) {
      const parts = key.split(':');
      const cp = Number(parts[0]);
      const kind = Number(parts[1]);
      const form = Number(parts[2]);
      const b = aliasMergedId.get((kind ? MOD_ALLCAPS_CP : MOD_CAPS_CP) + ':' + form);
      if (b === undefined) continue;
      const id = mergeBase + merges.size;
      merges.set(id, { a: CP_BASE + cp, b, rank: merges.size, alias: true, caps: kind });
      tokenLen.set(id, 3);
      capsMergedId.set(key, id);
    }
  }

  // ── alias translation: get the sequences onto runtime ids before counting.
  // Fresh runs translate synthetic alias ids in place. Resume runs still hold
  // raw (X, space-form) adjacencies (no synthetic pre-pass happened), so fuse
  // them directly with the prefix's runtime alias ids. Either way, learned
  // merges count/scan/emit real runtime ids — without this, the merge scan
  // can never match an alias pair, its count never decrements, and pickBest()
  // re-emits the same top pair forever.
  if (aliasTSp && !resume) {
    for (const seq of seqs) {
      for (let i = 0; i < seq.length; i++) {
        const id = seq[i];
        if (id >= CAPS_FLAG && id < CAPS_LIMIT) {
          const rest = id - CAPS_FLAG;
          const kind = Math.floor(rest / 0x400000);
          const form = Math.floor((rest % 0x400000) / 0x200000);
          const cp = rest % 0x200000;
          seq[i] = capsMergedId.get(cp + ':' + kind + ':' + form);
        } else if (id >= ALIAS_FLAG && id < ALIAS_LIMIT) {
          const form = Math.floor((id - ALIAS_FLAG) / 0x1000000);
          seq[i] = aliasMergedId.get((id - ALIAS_FLAG - form * 0x1000000) + ':' + form);
        }
      }
    }
  } else if (aliasTSp && resume) {
    for (const seq of seqs) {
      let w = 0;
      for (let i = 0; i < seq.length; i++) {
        const nxt = i + 1 < seq.length ? seq[i + 1] : -1;
        const form = tspIds.indexOf(nxt);
        if (form !== -1 && !tspIds.includes(seq[i])) {
          const aliasId = aliasMergedId.get((seq[i] - CP_BASE) + ':' + form);
          if (aliasId !== undefined) { seq[w++] = aliasId; i++; }
          else seq[w++] = seq[i];
        } else {
          seq[w++] = seq[i];
        }
      }
      seq.length = w;
    }
  }
  const learnSeqs = learnEvery > 1 ? seqs.filter((_, i) => i % learnEvery === 0) : seqs;

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

  // numMerges semantics: fresh runs = number of LEARNED merges (aliases come
  // on top); resume runs = TOTAL rules incl. the prefix.
  const learnTarget = resume ? Math.max(0, numMerges - merges.size) : numMerges;

  for (let m = 0; m < learnTarget; m++) {
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
    if (opts.onProgress) opts.onProgress(m + 1, learnTarget, merges);
  }

  return { merges, mergeBase, numMerges: merges.size, version: '1.1', maxTokenLength: maxTokenLen, aliases: resume ? aliasMergedId.size : aliasFreq.size };
}
