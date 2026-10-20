import test from 'node:test';
import assert from 'node:assert/strict';
import {REFERENCE_TOKENS,tokenize,tokenEditDistance,repeatedOutputsMatch} from '../src/phonetics/benchmark-analysis.js';
test('reference is a set of phoneme tokens, not a score',()=>{
  assert.deepEqual(REFERENCE_TOKENS['I work in sales.'],['aɪ','w','ɚ','k','ɪ','n','s','eɪ','l','z']);
});
test('edit distance equal outputs is zero; mismatches are discrete operations',()=>{
  const gold=REFERENCE_TOKENS['I work in sales.'];
  assert.equal(tokenEditDistance(gold,gold),0);
  assert.equal(tokenEditDistance(gold,gold.slice(0,-1)),1);
  assert.equal(tokenEditDistance(gold,[...gold.slice(0,-1),'s']),1);
  assert.equal(tokenEditDistance(gold,['b',...gold]),1);
  assert.equal(tokenEditDistance([],gold),gold.length);
});
test('deterministic comparison compares same raw IPA, not words or audio',()=>{
  const a={ipaRaw:'aɪ w ɚ k'},b={ipaRaw:'aɪ w ɚ k'},c={ipaRaw:'aɪ w ɚ'};
  assert.equal(repeatedOutputsMatch(a,b),true);
  assert.equal(repeatedOutputsMatch(a,c),false);
  assert.deepEqual(tokenize('aɪ  w  ɚ  k'),['aɪ','w','ɚ','k']);
});
