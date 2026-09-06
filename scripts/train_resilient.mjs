// Resilient full-corpus trainer for the containerized VPS: logs progress with
// RSS and checkpoints the vocab every CHECKPOINT learned merges. If the
// process is killed host-side (no trace inside the container), relaunching
// resumes from vocab_wip.json and only the lost tail is re-learned.
// This run uses the RE-ENCODED corpus (uppercase word variants + space-run
// symbols + caps fixes) and a FRESH alias table (11 space forms + caps
// triples), so no prefix is seeded.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { trainTokenizerFast } from "/root/aicl/scripts/train_fast.mjs";

const TARGET_LEARNED = 32768;
const CHECKPOINT = 4000;
const WIP = "/root/data/vocab_wip.json";
const OUT = "/root/data/vocab_big3.json";

const lines = readFileSync("/root/data/sample_pua3.txt", "utf-8").split("\n");
if (lines[lines.length - 1] === "") lines.pop();
console.log("corpus lines:", lines.length, "chars:", lines.reduce((a, b) => a + b.length, 0));

let prefix = null;
let targetTotal = TARGET_LEARNED; // fresh mode: numMerges counts LEARNED merges
if (existsSync(WIP)) {
  prefix = JSON.parse(readFileSync(WIP, "utf-8")).merges;
  const prefixAliases = prefix.filter(([, r]) => r.alias === true).length;
  targetTotal = prefixAliases + TARGET_LEARNED; // resume mode: numMerges = TOTAL
  console.log("resuming from", prefix.length, "merges (", prefixAliases, "aliases ) → target", targetTotal);
}

const t0 = Date.now();
const v = trainTokenizerFast(lines, {
  numMerges: targetTotal,
  maxTokenLength: 14,
  minFrequency: 2,
  aliasTrailingSpace: true,
  learnEvery: 4,
  skipDegeneratePairs: true,
  mergeBase: 100000,
  initMerges: prefix,
  onProgress: (done, total, merges) => {
    if (done % 100 === 0) {
      console.log(`learned ${done}/${total} ${((Date.now() - t0) / 60000).toFixed(1)}min rss ${Math.round(process.memoryUsage().rss / 1e6)}MB`);
    }
    if (done % CHECKPOINT === 0 || done === total) {
      writeFileSync(WIP, JSON.stringify({
        merges: [...merges.entries()], mergeBase: 100000,
        version: "1.1", numMerges: merges.size, maxTokenLength: 14,
      }));
      console.log(`CHECKPOINT ${merges.size} total merges saved (${((Date.now() - t0) / 60000).toFixed(1)}min)`);
    }
  },
});

console.log(`trained ${v.numMerges} merges (${v.aliases} aliases + ${v.numMerges - v.aliases} learned) in ${((Date.now() - t0) / 60000).toFixed(1)}min`);
const data = {
  merges: [...v.merges.entries()], mergeBase: v.mergeBase,
  version: v.version, numMerges: v.numMerges, maxTokenLength: v.maxTokenLength,
};
writeFileSync(OUT, JSON.stringify(data));
writeFileSync(WIP, JSON.stringify(data));
console.log("saved /root/data/vocab_big3.json");
