import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalPhonemeEngine} from '../src/phonetics/phonemes-local.js';

const audio=()=>({sampleRate:16000,samples:Float32Array.from({length:1600},(_,i)=>Math.sin(i/30)*.3)});
class FakeWorker {
  constructor(){this.messages=[];this.transfers=[];this.terminated=false}
  postMessage(msg,transfer){this.messages.push(msg);this.transfers.push(transfer)}
  respond(message){this.onmessage({data:message})}
  terminate(){this.terminated=true}
}
test('lazy worker: construction and model request occur only after analyze',async()=>{
  let creates=0,worker;
  const engine=new LocalPhonemeEngine({workerFactory:()=>{creates++;return worker=new FakeWorker()}});
  assert.equal(creates,0);
  await assert.rejects(engine.analyze({sampleRate:48000,samples:new Float32Array(1600)}),{code:'invalid-audio'});
  assert.equal(creates,0);
  const original=audio();const progresses=[];
  const promise=engine.analyze(original,{onProgress:x=>progresses.push(x)});
  assert.equal(creates,1);assert.equal(worker.messages[0].type,'ANALYZE');assert.equal(worker.messages[0].sampleRate,16000);
  assert.equal(worker.messages[0].samples.length,1600);assert.notEqual(worker.messages[0].samples,original.samples);
  assert.equal(worker.transfers[0].length,1);
  worker.respond({type:'progress',requestId:1,stage:'loading-model',percent:50});
  worker.respond({type:'result',requestId:1,ipaRaw:'h ɛ l oʊ',phonemeScore:null,confidenceAvailable:false});
  const result=await promise;
  assert.equal(result.ipaRaw,'h ɛ l oʊ');assert.equal(result.phonemeScore,null);
  assert.equal(progresses.length,1);assert.equal(original.samples.length,1600);
  engine.dispose();assert.equal(worker.terminated,true);
});
test('error from worker is propagated; no 0% pronunciation score is fabricated',async()=>{
  let worker;const engine=new LocalPhonemeEngine({workerFactory:()=>worker=new FakeWorker()});
  const promise=engine.analyze(audio());worker.respond({type:'error',requestId:1,code:'model-failed',message:'ONNX could not initialize'});
  await assert.rejects(promise,{code:'model-failed'});
  engine.dispose();
});
test('aborting analysis terminates worker and removes pending job',async()=>{
  let worker;const engine=new LocalPhonemeEngine({workerFactory:()=>worker=new FakeWorker()});
  const ctrl=new AbortController();const promise=engine.analyze(audio(),{signal:ctrl.signal});ctrl.abort();
  await assert.rejects(promise,{code:'aborted'});assert.equal(worker.terminated,true);
});
test('worker creation failure gives explicit error without requesting network',async()=>{
  const engine=new LocalPhonemeEngine({workerFactory:()=>{throw new Error('not supported')}});
  await assert.rejects(engine.analyze(audio()),{code:'worker-unavailable'});
});
test('timeouts close hung worker without fake results',async()=>{
  let worker;const engine=new LocalPhonemeEngine({workerFactory:()=>worker=new FakeWorker(),timeoutMs:15});
  await assert.rejects(engine.analyze(audio()),{code:'timeout'});assert.equal(worker.terminated,true);
});

test('FP16 variant is forwarded to isolated Worker and invalid variants are rejected',async()=>{
  let w;const engine=new LocalPhonemeEngine({workerFactory:()=>w=new FakeWorker(),dtype:'fp16'});
  const pending=engine.analyze(audio());
  assert.equal(w.messages[0].dtype,'fp16');
  w.respond({type:'result',requestId:1,ipaRaw:'aɪ',dtype:'fp16',phonemeScore:null});
  const result=await pending;assert.equal(result.dtype,'fp16');engine.dispose();
  assert.throws(()=>new LocalPhonemeEngine({dtype:'garbage'}),{code:'invalid-dtype'});
});
