/**
 * AICL Tokenizer — custom BPE over AICL symbol sequences
 *
 * Stage 2 of the pipeline. Takes already-encoded AICL text (PUA symbols)
 * and further compresses it by learning which frequent symbol *pairs*
 * collapse into single token IDs.
 *
 * Design (clean integer-IDs, string pair keys for collision-free merging):
 *   - Every code point has a base token id: cpBase + codePoint
 *   - Learned merges assign ids at mergeTokenBase upward (0..numMerges-1)
 *   - A merge rule maps an ordered pair (tokenA, tokenB) -> id
 *   - Pairs are keyed by the string `${a}:${b}` (no integer overflow)
 *   - Tokenize: greedy bottom-up BPE on the ID sequence
 *   - Detokenize: reverse the ids back to code-point/AICL text
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { codePoints } from '../unicode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VOCAB_PATH = join(__dirname, '..', '..', 'tokenizer', 'vocab.json');

/** Base id for a raw code point self-token. */
export const CP_BASE = 0x1000000;

/** Default id where learned merged tokens begin. */
export const DEFAULT_MERGE_BASE = 100000;

/** Token id for a single code point. */
export function cpToId(ch) {
  return CP_BASE + ch.codePointAt(0);
}

/** Self-token id -> code point char. */
export function idToCp(id) {
  return String.fromCodePoint(id - CP_BASE);
}

/** Collision-free pair key string. */
function pairKey(a, b) {
  return a + ':' + b;
}

/**
 * Empty (untrained) tokenizer vocabulary.
 */
export function emptyVocab(mergeBase = DEFAULT_MERGE_BASE) {
  return { merges: new Map(), mergeBase, numMerges: 0, version: 'empty' };
}

/**
 * Apply BPE merges greedily to a token-id sequence.
 * Repeatedly replaces the adjacent pair with the lowest (earliest) merge
 * rank until no merge applies.
 *
 * @param {number[]} ids
 * @param {Map<number,{a:number,b:number,rank:number}>} merges mergedId -> rule
 * @returns {number[]}
 */
export function bpeMerge(ids, merges) {
  // Build pair index: pairKey -> {rank, mergedId}
  const pairIndex = new Map();
  for (const [mergedId, rule] of merges) {
    const key = pairKey(rule.a, rule.b);
    const existing = pairIndex.get(key);
    if (!existing || rule.rank < existing.rank) {
      pairIndex.set(key, { rank: rule.rank, mergedId });
    }
  }

  const seq = ids.slice();
  let changed = true;
  while (changed) {
    changed = false;
    let bestKey = null;
    let bestRank = Infinity;
    let bestMergedId = null;
    let bestIdx = -1;
    for (let i = 0; i < seq.length - 1; i++) {
      const key = pairKey(seq[i], seq[i + 1]);
      const rule = pairIndex.get(key);
      if (rule && rule.rank < bestRank) {
        bestRank = rule.rank;
        bestKey = key;
        bestMergedId = rule.mergedId;
        bestIdx = i;
      }
    }
    if (bestMergedId !== null) {
      seq.splice(bestIdx, 2, bestMergedId);
      changed = true;
    }
  }
  return seq;
}

/**
 * Tokenize AICL text into token IDs.
 * @param {string} aiclText
 * @param {object} [vocab]
 * @returns {number[]}
 */
export function tokenize(aiclText, vocab = loadTokenizer()) {
  const ids = codePoints(aiclText).map(cpToId);
  return bpeMerge(ids, vocab.merges);
}

/**
 * Detokenize token IDs back into AICL text.
 * @param {number[]} ids
 * @param {object} [vocab]
 * @returns {string}
 */
export function detokenize(ids, vocab = loadTokenizer()) {
  const out = [];
  const expand = (id) => {
    if (id >= vocab.mergeBase && id < vocab.mergeBase + vocab.numMerges) {
      const rule = vocab.merges.get(id);
      if (rule) {
        expand(rule.a);
        expand(rule.b);
        return;
      }
    }
    if (id >= CP_BASE) {
      out.push(idToCp(id));
    }
  };
  for (const id of ids) expand(id);
  return out.join('');
}

/**
 * Train BPE merges on a corpus of AICL strings.
 * @param {string[]} aiclCorpus
 * @param {object} [opts] { numMerges?, mergeBase? }
 * @returns {object} vocab
 */
export function trainTokenizer(aiclCorpus, opts = {}) {
  const numMerges = opts.numMerges ?? 4096;
  const mergeBase = opts.mergeBase ?? DEFAULT_MERGE_BASE;

  const seqs = aiclCorpus.map((t) => codePoints(t).map(cpToId));
  const merges = new Map();
  let rank = 0;

  for (let m = 0; m < numMerges; m++) {
    const pairCounts = new Map();
    for (const seq of seqs) {
      for (let i = 0; i < seq.length - 1; i++) {
        const key = pairKey(seq[i], seq[i + 1]);
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
    if (pairCounts.size === 0) break;

    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of pairCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    if (bestKey === null || bestCount < 2) break;

    const sep = bestKey.indexOf(':');
    const a = Number(bestKey.slice(0, sep));
    const b = Number(bestKey.slice(sep + 1));
    const mergedId = mergeBase + rank;
    merges.set(mergedId, { a, b, rank });
    rank++;

    for (let s = 0; s < seqs.length; s++) {
      const seq = seqs[s];
      const next = [];
      for (let i = 0; i < seq.length; i++) {
        if (i < seq.length - 1 && seq[i] === a && seq[i + 1] === b) {
          next.push(mergedId);
          i++;
        } else {
          next.push(seq[i]);
        }
      }
      seqs[s] = next;
    }
  }

  return { merges, mergeBase, numMerges: merges.size, version: '1.0' };
}

/**
 * Load tokenizer vocab from disk (or empty if missing).
 */
export function loadTokenizer() {
  if (!existsSync(VOCAB_PATH)) return emptyVocab();
  const raw = JSON.parse(readFileSync(VOCAB_PATH, 'utf-8'));
  const merges = new Map(raw.merges.map(([id, rule]) => [id, rule]));
  return {
    merges,
    mergeBase: raw.mergeBase ?? DEFAULT_MERGE_BASE,
    numMerges: raw.numMerges ?? merges.size,
    version: raw.version ?? '1.0',
  };
}

/**
 * Save tokenizer vocab to disk.
 */
export function saveTokenizer(vocab, path = VOCAB_PATH) {
  const data = {
    merges: [...vocab.merges.entries()],
    mergeBase: vocab.mergeBase ?? DEFAULT_MERGE_BASE,
    version: vocab.version ?? '1.0',
    numMerges: vocab.numMerges ?? vocab.merges.size,
  };
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** Train + save in one call. */
export function saveTrained(corpus, opts = {}, path = VOCAB_PATH) {
  const vocab = trainTokenizer(corpus, opts);
  saveTokenizer(vocab, path);
  return vocab;
}
