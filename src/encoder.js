/**
 * AICL Encoder — trie-accelerated
 * 1. Longest-match via trie O(maxLen) per position
 * 2. Word-based fallback when bestLen==1 (with all-caps direct lookup)
 * 3. Literal
 */
import { build } from './dict.js';
import { codePoints, isPuaCodePoint, ESCAPE_MARKER, requireText } from './unicode.js';

function buildTrie(patternToSymbol){
  const root={children:new Map(), symbol:null};
  for(const [pat,sym] of patternToSymbol){
    if(pat.startsWith('MOD_')) continue;
    let node=root;
    for(const ch of pat){
      if(!node.children.has(ch)) node.children.set(ch,{children:new Map(), symbol:null});
      node=node.children.get(ch);
    }
    node.symbol=sym;
  }
  return root;
}
function trieMatch(root, chars, i){
  let node=root, bestLen=0, bestSym=null;
  for(let j=i;j<chars.length;j++){
    const nxt=node.children.get(chars[j]);
    if(!nxt) break;
    node=nxt;
    if(node.symbol){ bestLen=j-i+1; bestSym=node.symbol; }
  }
  return [bestLen, bestSym];
}
function extractWord(chars,i){
  if(i>=chars.length) return '';
  if(!/[a-zA-Z0-9_'-]/.test(chars[i])) return '';
  let w=chars[i];
  for(let j=i+1;j<chars.length;j++){
    if(/[a-zA-Z0-9_'-]/.test(chars[j])) w+=chars[j]; else break;
  }
  return w;
}
function punctuationToModifier(ch){
  const m={' ':'MOD_TRAIL_SPACE',',':'MOD_TRAIL_COMMA','.':'MOD_TRAIL_PERIOD','?':'MOD_TRAIL_QUESTION','!':'MOD_TRAIL_EXCL',';':'MOD_TRAIL_SEMI',':':'MOD_TRAIL_COLON',')':'MOD_TRAIL_RPAREN',']':'MOD_TRAIL_RBRACKET','}':'MOD_TRAIL_RBRACE','"':'MOD_TRAIL_RQUOTE'};
  return m[ch]||null;
}
function charCount(s){ return [...s].length; }

let trieCache=null;
function getTrie(patternToSymbol){
  if(trieCache) return trieCache;
  trieCache=buildTrie(patternToSymbol);
  return trieCache;
}
let fragmentCache=null;
function getFragmentPatterns(sortedPatterns){
  if(fragmentCache) return fragmentCache;
  fragmentCache = sortedPatterns.filter(p=> p.length>=2 && p.length<=4).sort((a,b)=> b.length - a.length || (a<b?-1:1));
  return fragmentCache;
}

export function encode(text, opts={}){
  requireText(text, 'text');
  const {sortedPatterns, patternToSymbol}=build();
  const steps=opts.steps?[]:null;
  const trackMapping=opts.trackMapping;
  const trie=getTrie(patternToSymbol);
  let output='',matches=0,literals=0;
  const chars=codePoints(text);
  // rawToAicl[pos] = index in AICL output where this raw char's symbol starts
  const rawToAicl = trackMapping ? new Array(chars.length).fill(-1) : null;
  let aiclPos=0;
  let i=0;
  while(i<chars.length){
    const [bestLen,bestSym]=trieMatch(trie, chars, i);
    let bestPat=null;
    if(bestSym) bestPat=chars.slice(i,i+bestLen).join('');

    if(bestLen===1){
      const word=extractWord(chars,i);
      if(word.length>1){
        const lower=word.toLowerCase();
        const isAllCaps = word===word.toUpperCase() && /[A-Z]/.test(word);
        if(isAllCaps){
          const capsSym=patternToSymbol.get(word);
          if(capsSym){
            if(trackMapping) for(let j=i;j<i+word.length;j++) rawToAicl[j]=aiclPos;
            output+=capsSym; matches++; if(steps) steps.push({type:'base',pattern:word,pos:i});
            aiclPos++;
            i+=word.length;
            while(i<chars.length){
              const mn=punctuationToModifier(chars[i]);
              if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); aiclPos++; i++; continue; } }
              break;
            }
            continue;
          }
          // No dedicated uppercase entry: reuse the lowercase base symbol and
          // let MOD_ALLCAPS transform the whole buffer — one modifier instead
          // of spelling the word letter-by-letter (which expanded it).
          const baseSym=patternToSymbol.get(lower);
          if(baseSym){
            if(trackMapping) for(let j=i;j<i+word.length;j++) rawToAicl[j]=aiclPos;
            output+=baseSym; matches++; if(steps) steps.push({type:'base',pattern:lower,pos:i});
            aiclPos++;
            const acs=patternToSymbol.get('MOD_ALLCAPS');
            if(acs){ output+=acs; matches++; if(steps) steps.push({type:'modifier',name:'MOD_ALLCAPS',pos:i}); aiclPos++; }
            i+=word.length;
            while(i<chars.length){
              const mn=punctuationToModifier(chars[i]);
              if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); aiclPos++; i++; continue; } }
              break;
            }
            continue;
          }
          // No base either: fall through to the shared fragment path; each
          // fragment rides MOD_ALLCAPS below.
        } else {
          // A whole-word base symbol expands to the lowercase pattern and
          // MOD_CAPS can only fix up the first char, so words with internal
          // capitals (camelCase) must not use the base-symbol path. The
          // fragment path below can capitalize each fragment individually.
          const rest=word.slice(1);
          if(rest===rest.toLowerCase()){
            const baseSym=patternToSymbol.get(lower);
            if(baseSym){
              if(trackMapping) for(let j=i;j<i+lower.length;j++) rawToAicl[j]=aiclPos;
              output+=baseSym; matches++; if(steps) steps.push({type:'base',pattern:lower,pos:i});
              aiclPos++;
              i+=lower.length;
              if(word[0]!==lower[0]){
                const cs=patternToSymbol.get('MOD_CAPS'); if(cs){ output+=cs; matches++; if(steps) steps.push({type:'modifier',name:'MOD_CAPS',pos:i}); aiclPos++; }
              }
              while(i<chars.length){
                const mn=punctuationToModifier(chars[i]);
                if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); aiclPos++; i++; continue; } }
                break;
              }
              continue;
            }
          }
        }
        let fragI=0, matchedFrag=false;
        const fragPatterns = getFragmentPatterns(sortedPatterns);
        while(fragI<lower.length){
          let bestFrag=null, bestFragLen=0;
          for(const frag of fragPatterns){
            if(frag.length <= lower.length - fragI && lower.startsWith(frag, fragI)){
              // For all-caps words MOD_ALLCAPS fixes every char of the
              // fragment, so the interior-capital guard doesn't apply.
              // Otherwise only usable when no capital falls INSIDE the span:
              // MOD_CAPS can capitalize the fragment's first char only.
              if(isAllCaps || word.slice(fragI+1, fragI+frag.length) === lower.slice(fragI+1, fragI+frag.length)){
                bestFrag=frag; bestFragLen=frag.length; break;
              }
            }
          }
          if(bestFrag){
            if(trackMapping) for(let j=i+fragI;j<i+fragI+bestFragLen;j++) rawToAicl[j]=aiclPos;
            const fs=patternToSymbol.get(bestFrag);
            if(fs){
              output+=fs; matches++; if(steps) steps.push({type:'fragment',pattern:bestFrag,pos:i+fragI}); aiclPos++;
              // All-caps words may hide capitals anywhere inside a fragment
              // (e.g. 4RC2 → frags "4r","c2"), so every letter-bearing
              // fragment needs MOD_ALLCAPS — its buffer is just that fragment.
              // Otherwise only the fragment's first char can differ (MOD_CAPS).
              const needsCaps = isAllCaps ? /[a-z]/.test(bestFrag) : word[fragI]!==lower[fragI];
              if(needsCaps){
                const cs=patternToSymbol.get(isAllCaps ? 'MOD_ALLCAPS' : 'MOD_CAPS');
                if(cs){ output+=cs; matches++; if(steps) steps.push({type:'modifier',name:isAllCaps?'MOD_ALLCAPS':'MOD_CAPS',pos:i+fragI}); aiclPos++; }
              }
              fragI+=bestFragLen; matchedFrag=true; continue;
            }
          }
          break;
        }
        if(matchedFrag && fragI>0){
          i+=fragI;
          while(i<chars.length){
            const mn=punctuationToModifier(chars[i]);
            if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); aiclPos++; i++; continue; } }
            break;
          }
          continue;
        }
      }
    }
    if(bestSym){
      if(trackMapping) for(let j=i;j<i+bestLen;j++) rawToAicl[j]=aiclPos;
      output+=bestSym; matches++; if(steps) steps.push({type:'match',pattern:bestPat,pos:i});
      aiclPos+=bestLen > 1 ? [...bestSym].length : 1;
      i+=bestLen; continue;
    }
    const ch=chars[i];
    if(trackMapping) rawToAicl[i]=aiclPos;
    output+= isPuaCodePoint(ch.codePointAt(0)) ? ESCAPE_MARKER+ch : ch;
    aiclPos++;
    literals++; if(steps) steps.push({type:'literal',char:ch,pos:i});
    i++;
  }
  const result={output,matches,literals,charsIn:chars.length,charsOut:charCount(output)};
  if(steps) result.steps=steps;
  if(trackMapping) result.rawToAicl=rawToAicl;
  return result;
}
export function encodeToString(text){ return encode(text).output; }
