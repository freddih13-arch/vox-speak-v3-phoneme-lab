import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCtcLogits } from '../src/phonetics/ctc-decode.js';
import { GRUUT_VOCAB } from '../src/phonetics/vocab-gruut.js';
const classes=45;
function logitsFor(ids){
 const data=new Float32Array(ids.length*classes).fill(-10);
 ids.forEach((id,t)=>{data[t*classes+id]=7});
 return {dims:[1,ids.length,classes],data};
}
test('CTC greedy collapse merges repeated frames and ignores PAD blank',()=>{
 const out=decodeCtcLogits(logitsFor([42,1,1,42,40,40,42,34,34,42,26,42,11]),GRUUT_VOCAB);
 assert.equal(out.ipaRaw,'aɪ θ ɪ ŋ k');
 assert.equal(out.frameCount,13);
 assert.equal(out.confidenceAvailable,false);
});
test('CTC allows a repeated IPA sound if separated by blank',()=>{
 const out=decodeCtcLogits(logitsFor([17,42,17,42,18]),GRUUT_VOCAB);
 assert.equal(out.ipaRaw,'s s t');
});
test('CTC word separator preserved between words',()=>{
 const out=decodeCtcLogits(logitsFor([1,42,0,42,40,34,42,26,11]),GRUUT_VOCAB);
 assert.equal(out.ipaRaw,'aɪ  θ ɪ ŋ k');
});
test('CTC rejects malformed tensors, NaNs, vocab mismatch',()=>{
 assert.throws(()=>decodeCtcLogits({dims:[1,3,45],data:new Float32Array(4)},GRUUT_VOCAB),/dimensiones/);
 const l=logitsFor([1,2]);l.data[0]=NaN;
 assert.throws(()=>decodeCtcLogits(l,GRUUT_VOCAB),/finitos/);
 assert.throws(()=>decodeCtcLogits(logitsFor([1]),{'[PAD]':42}),/vocabulario/);
});
test('correct phoneme inventory: 45 unique IDs and no tokenizer.json dependency',()=>{
 const ids=Object.values(GRUUT_VOCAB);
 assert.equal(ids.length,45); // vocab 0..42 plus tokenizer_config special IDs 43,44
 assert.equal(new Set(ids).size,45);
 assert.deepEqual(ids.slice().sort((a,b)=>a-b),Array.from({length:45},(_,i)=>i));
});
