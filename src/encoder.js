/**
 * AICL Encoder — trie-accelerated
 * 1. Longest-match via trie O(maxLen) per position
 * 2. Word-based fallback when bestLen==1 (with all-caps direct lookup)
 * 3. Literal
 */
import { build } from './dict.js';
import { codePoints, isPuaCodePoint, ESCAPE_MARKER } from './unicode.js';

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

export function encode(text, opts={}){
  const {sortedPatterns, patternToSymbol}=build();
  const steps=opts.steps?[]:null;
  const trie=getTrie(patternToSymbol);
  let output='',matches=0,literals=0;
  const chars=codePoints(text);
  let i=0;
  while(i<chars.length){
    const [bestLen,bestSym]=trieMatch(trie, chars, i);
    let bestPat=null;
    if(bestSym) bestPat=chars.slice(i,i+bestLen).join('');

    if(bestLen===1){
      const word=extractWord(chars,i);
      if(word.length>1){
        if(word===word.toUpperCase()){
          const capsSym=patternToSymbol.get(word);
          if(capsSym){
            output+=capsSym; matches++; if(steps) steps.push({type:'base',pattern:word,pos:i});
            i+=word.length;
            while(i<chars.length){
              const mn=punctuationToModifier(chars[i]);
              if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); i++; continue; } }
              break;
            }
            continue;
          }
        }
        const lower=word.toLowerCase();
        const baseSym=patternToSymbol.get(lower);
        if(baseSym){
          output+=baseSym; matches++; if(steps) steps.push({type:'base',pattern:lower,pos:i});
          i+=lower.length;
          if(word[0]!==lower[0]){
            const cs=patternToSymbol.get('MOD_CAPS'); if(cs){ output+=cs; matches++; if(steps) steps.push({type:'modifier',name:'MOD_CAPS',pos:i}); }
          }
          while(i<chars.length){
            const mn=punctuationToModifier(chars[i]);
            if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); i++; continue; } }
            break;
          }
          continue;
        }
        let fragI=0, matchedFrag=false;
        while(fragI<lower.length){
          let bestFrag=null, bestFragLen=0;
          for(const frag of sortedPatterns){
            const fl=frag.length; if(fl<2||fl>4) continue;
            if(fl<=lower.length-fragI && lower.startsWith(frag,fragI)){
              if(fl>bestFragLen){ bestFrag=frag; bestFragLen=fl; } break;
            }
          }
          if(bestFrag){
            const fs=patternToSymbol.get(bestFrag); if(fs){ output+=fs; matches++; if(steps) steps.push({type:'fragment',pattern:bestFrag,pos:i+fragI}); fragI+=bestFragLen; matchedFrag=true; continue; }
          }
          break;
        }
        if(matchedFrag && fragI>0){
          i+=fragI;
          if(word[0]!==lower[0]){ const cs=patternToSymbol.get('MOD_CAPS'); if(cs){ output+=cs; matches++; if(steps) steps.push({type:'modifier',name:'MOD_CAPS',pos:i}); } }
          while(i<chars.length){
            const mn=punctuationToModifier(chars[i]);
            if(mn){ const ms=patternToSymbol.get(mn); if(ms){ output+=ms; matches++; if(steps) steps.push({type:'modifier',name:mn,pos:i}); i++; continue; } }
            break;
          }
          continue;
        }
      }
    }
    if(bestSym){
      output+=bestSym; matches++; if(steps) steps.push({type:'match',pattern:bestPat,pos:i});
      i+=bestLen; continue;
    }
    const ch=chars[i];
    output+= isPuaCodePoint(ch.codePointAt(0)) ? ESCAPE_MARKER+ch : ch;
    literals++; if(steps) steps.push({type:'literal',char:ch,pos:i});
    i++;
  }
  const result={output,matches,literals,charsIn:chars.length,charsOut:charCount(output)};
  if(steps) result.steps=steps;
  return result;
}
export function encodeToString(text){ return encode(text).output; }
