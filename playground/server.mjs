#!/usr/bin/env node
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { encode } from '../src/encoder.js';
import { decode } from '../src/decoder.js';
import { tokenize, loadTokenizer, bpeMerge, cpToId } from '../src/tokenizer/index.js';
import { sanitizeText, inspectText, MAX_INPUT_CHARS, MAX_BODY_BYTES, codePoints } from '../src/unicode.js';
import { encode as gptEncode } from 'gpt-tokenizer';
import llamaTok from 'llama-tokenizer-js/llama-tokenizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PLAY = __dirname;
const tok = llamaTok;

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.txt':'text/plain; charset=utf-8',
};

function send(res, code, body, type='text/plain; charset=utf-8'){
  res.writeHead(code, {'Content-Type': type, 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type'});
  res.end(body);
}

/**
 * Compute token map: for each AICL char, which token index it belongs to.
 * Mirrors BPE merge logic but tracks character→token assignments.
 */
function computeTokenMap(aiclText, vocab) {
  const chars = [...aiclText];
  const n = chars.length;
  if (n === 0) return [];

  // Start: each char is its own token, tracked by char position
  // Each "slot" holds a list of char positions belonging to that token
  let slots = chars.map((_, i) => [i]);
  let ids = chars.map(ch => cpToId(ch));

  // Build pair index
  const pairIndex = new Map();
  for (const [mergedId, rule] of vocab.merges) {
    const key = rule.a + ':' + rule.b;
    const existing = pairIndex.get(key);
    if (!existing || rule.rank < existing.rank) {
      pairIndex.set(key, { rank: rule.rank, mergedId, a: rule.a, b: rule.b });
    }
  }

  while (true) {
    let bestRank = Infinity;
    let bestRule = null;
    for (let i = 0; i < ids.length - 1; i++) {
      const key = ids[i] + ':' + ids[i + 1];
      const rule = pairIndex.get(key);
      if (rule && rule.rank < bestRank) {
        bestRank = rule.rank;
        bestRule = rule;
        if (bestRank === 0) break;
      }
    }
    if (!bestRule) break;

    const nextIds = [];
    const nextSlots = [];
    for (let i = 0; i < ids.length; i++) {
      if (i < ids.length - 1 && ids[i] === bestRule.a && ids[i + 1] === bestRule.b) {
        nextIds.push(bestRule.mergedId);
        nextSlots.push([...slots[i], ...slots[i + 1]]);
        i++;
      } else {
        nextIds.push(ids[i]);
        nextSlots.push(slots[i]);
      }
    }
    ids = nextIds;
    slots = nextSlots;
  }

  // Build result: tokenMap[charPos] = tokenIndex
  const tokenMap = new Array(n);
  for (let tokIdx = 0; tokIdx < slots.length; tokIdx++) {
    for (const charPos of slots[tokIdx]) {
      tokenMap[charPos] = tokIdx;
    }
  }
  return tokenMap;
}

function serveStatic(req, res){
  let path = req.url.split('?')[0];
  if(path === '/') path = '/playground/index.html';
  if(path === '/playground' || path === '/playground/') path = '/playground/index.html';
  let decoded=''; try{ decoded = decodeURIComponent(path); }catch{ return false; }
  if(decoded.includes('\0') || decoded.includes('..')) return false;
  let file = join(ROOT, decoded);
  if(!file.startsWith(ROOT) || !existsSync(file)) return false;
  try{
    const data = readFileSync(file);
    const ext = extname(file);
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
    return true;
  }catch{ return false; }
}

const server = createServer(async (req, res)=>{
  if(req.method === 'OPTIONS'){ send(res, 204, '', 'text/plain'); return; }

  const url = req.url.split('?')[0];

  if(url === '/api/health'){
    const v = loadTokenizer();
    send(res, 200, JSON.stringify({ok:true, merges: v.numMerges, maxTokenLength: v.maxTokenLength}), 'application/json; charset=utf-8');
    return;
  }

  if(url === '/api/tokenize' && req.method === 'POST'){
    let body=''; let bytes=0; let tooLarge=false;
    for await(let chunk of req){
      bytes += chunk.length;
      if(bytes > MAX_BODY_BYTES) { tooLarge=true; break; }
      body+=chunk;
    }
    if(tooLarge){ send(res, 413, JSON.stringify({error:`body too large > ${MAX_BODY_BYTES} bytes`}), 'application/json; charset=utf-8'); return; }
    let text='';
    try{ text = JSON.parse(body || '{}').text ?? ''; }catch{ send(res,400, JSON.stringify({error:'invalid JSON'}), 'application/json; charset=utf-8'); return; }
    if(typeof text !== 'string'){ send(res,400, JSON.stringify({error:'text must be a string'}), 'application/json; charset=utf-8'); return; }
    if([...text].length > MAX_INPUT_CHARS){ send(res,413, JSON.stringify({error:`text too large > ${MAX_INPUT_CHARS} chars`}), 'application/json; charset=utf-8'); return; }
    const inspected = inspectText(text);
    const sanitized = inspected.hasControl || inspected.hasSurrogate;
    if(sanitized) text = sanitizeText(text);
    const t0 = Date.now();
    const t1 = Date.now();
    const enc = encode(text, {steps:true, trackMapping:true});
    const t2 = Date.now();
    const aicl = enc.output;
    const vocab = loadTokenizer();
    const ids = tokenize(aicl, vocab);

    // Compute token map: which AICL char position belongs to which token index
    const tokenMap = computeTokenMap(aicl, vocab);
    const rawToAicl = enc.rawToAicl;
    const t3 = Date.now();
    const dec = decode(aicl).output;
    const roundtripOk = dec === text;
    const rawChars = [...text].length;
    const aiclChars = [...aicl].length;
    const aiclTokens = ids.length;
    const stage1x = aiclChars ? +(rawChars / aiclChars).toFixed(2) : 0;
    const stage2x = aiclTokens ? +(aiclChars / aiclTokens).toFixed(2) : 0;
    let gpt3=0,gpt4=0,gpt4o=0,gpt5=0,llama=0;
    try{ gpt3 = gptEncode(text, {model:'gpt-3.5-turbo'}).length; }catch{}
    try{ gpt4 = gptEncode(text, {model:'gpt-4'}).length; }catch{}
    try{ gpt4o = gptEncode(text, {model:'gpt-4o'}).length; }catch{}
    try{ gpt5 = gptEncode(text, {model:'gpt-5'}).length; }catch{}
    try{ llama = tok.encode(text).length; }catch{}
    if(!text){ gpt3=gpt4=gpt4o=gpt5=llama=0; }
    const winVsGpt4o = gpt4o && aiclTokens ? +(gpt4o / aiclTokens).toFixed(2) : 0;
    const savePct = gpt4o && aiclTokens ? +((1 - aiclTokens/gpt4o)*100).toFixed(1) : 0;
    const payload = {
      vocab: {merges: vocab.numMerges, maxTokenLength: vocab.maxTokenLength, mergeBase: vocab.mergeBase},
      timings: {encodeMs: +(t2-t1).toFixed(1), tokenizeMs: +(t3-t2).toFixed(1), totalMs: +(t3-t0).toFixed(1)},
      encodeMs: t3-t0,
      sanitized, inspected,
      stats: {rawChars, aiclChars, aiclTokens, stage1x, stage2x, winVsGpt4o, savePct},
      compare: {gpt3, gpt4, gpt4o, gpt5, llama, aicl: aiclTokens},
      pipeline: {
        aicl, aiclLen: aiclChars, tokenIds: ids, tokenMap, rawToAicl, roundtripOk,
        matches: enc.matches, literals: enc.literals,
        steps: (enc.steps || []).slice(0, 400),
      }
    };
    send(res, 200, JSON.stringify(payload), 'application/json; charset=utf-8');
    return;
  }

  if(url.startsWith('/playground/') || url === '/playground' || url.startsWith('/assets/') || url === '/' ){
    if(serveStatic(req,res)) return;
  }
  if(url === '/api/tokenize' && req.method !== 'POST'){
    send(res, 405, 'Use POST', 'text/plain; charset=utf-8'); return;
  }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

const PORT = Number(process.env.PORT || process.env.PLAYGROUND_PORT || 8787);
server.listen(PORT, ()=> console.log(`AICL playground → http://localhost:${PORT}/  (also /playground/)`));
