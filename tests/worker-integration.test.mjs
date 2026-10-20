import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'../src/phonetics');
let count=0;
async function createHarness(fake){
  let source=readFileSync(resolve(root,'phoneme-worker.js'),'utf8')
    .replace("from './ctc-decode.js'",`from '${pathToFileURL(resolve(root,'ctc-decode.js'))}'`)
    .replace("from './vocab-gruut.js'",`from '${pathToFileURL(resolve(root,'vocab-gruut.js'))}'`)
    .replace('await import(TRANSFORMERS_CDN)','await Promise.resolve(globalThis.__mockTransformers)');
  const messages=[];
  globalThis.self={postMessage:msg=>messages.push(msg)};
  globalThis.__mockTransformers=fake;
  await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#${count++}`);
  return {messages,send:async samples=>{
    await globalThis.self.onmessage({data:{type:'ANALYZE',requestId:1,samples,sampleRate:16000}});
  }};
}
const logits=(ids)=>{
 const classes=45,data=new Float32Array(ids.length*classes).fill(-8);
 ids.forEach((id,t)=>data[t*classes+id]=12);
 return {dims:[1,ids.length,classes],data};
};
const audio=()=>Float32Array.from({length:3200},(_,i)=>Math.sin(i/12)*.25);
test('worker lazily loads extractor/model and greedily decodes IPA without pipeline tokenizer.json',async()=>{
 let loaded=0, featureCalls=0, modelCalls=0;
 const h=await createHarness({
   env:{backends:{onnx:{wasm:{}}},useBrowserCache:false},
   AutoFeatureExtractor:{from_pretrained:async()=>{loaded++;return async()=>{featureCalls++;return {input_values:'fake'};}}},
   AutoModelForCTC:{from_pretrained:async()=>{loaded++;return async()=>{modelCalls++;return {logits:logits([1,42,0,42,40,42,34,42,26,42,11])};}}},
 });
 assert.equal(loaded,0,'lazy: no model before first ANALYZE');
 await h.send(audio());
 assert.equal(loaded,2);
 assert.equal(featureCalls,1);assert.equal(modelCalls,1);
 const last=h.messages.at(-1);
 assert.equal(last.type,'result');assert.equal(last.ipaRaw,'aɪ  θ ɪ ŋ k');
 assert.equal(last.phonemeScore,null);assert.equal(last.confidenceAvailable,false);
 assert.equal(h.messages.some(x=>x.stage==='loading-feature-extractor'),true);
 assert.equal(h.messages.some(x=>x.stage==='loading-onnx-model'),true);
 assert.equal(h.messages.some(x=>x.stage==='inferencing'),true);
});
test('worker surfaces ONNX loading errors as model-failed, no fabricated IPA',async()=>{
 const h=await createHarness({
  env:{backends:{onnx:{wasm:{}}}},
  AutoFeatureExtractor:{from_pretrained:async()=>async()=>({input_values:'fake'})},
  AutoModelForCTC:{from_pretrained:async()=>{throw new Error('Unable to fetch onnx/model_q4.onnx');}},
 });
 await h.send(audio());
 const last=h.messages.at(-1);
 assert.equal(last.type,'error');assert.equal(last.code,'model-failed');
 assert.match(last.message,/loading-onnx-model/);
 assert.match(last.message,/model_q4.onnx/);
});
