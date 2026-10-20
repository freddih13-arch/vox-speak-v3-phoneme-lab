/** VOX Phoneme Benchmark v0.3 — lazy CTC ONNX. The runtime is bound to one dtype per Worker.
 * q4: 89.8 MB, fp16: 189 MB. No audio is uploaded; no phonetic score is asserted.
 */
import { decodeCtcLogits } from './ctc-decode.js';
import { GRUUT_VOCAB } from './vocab-gruut.js';
const MODEL_ID = 'onnx-community/wav2vec2-ljspeech-gruut-ONNX';
const MODEL_REVISION = '263beb019ab71cb258a97a35b0e10db9a4ddb670';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_SAMPLES = 15 * 16000;
let runtimePromise = null, runtimeDtype = null, analyzing = false, loadingStage='idle';
const send=(requestId,type,payload={})=>self.postMessage({requestId,type,...payload});
const status=(requestId,stage)=>{loadingStage=stage;send(requestId,'status',{stage})};
async function getRuntime(requestId,dtype) {
  if(runtimePromise && dtype!==runtimeDtype) throw Object.assign(new Error('Para cambiar de precisión hay que iniciar otro worker.'),{code:'dtype-mismatch'});
  if(!runtimePromise){
    runtimeDtype=dtype;
    runtimePromise=(async()=>{
      status(requestId,'loading-library');
      const {AutoFeatureExtractor,AutoModelForCTC,env}=await import(TRANSFORMERS_CDN);
      env.backends.onnx.wasm.numThreads=1;
      env.useBrowserCache=true;
      const opts={revision:MODEL_REVISION, progress_callback: event=>{
        if(!event||typeof event!=='object')return;
        const n=event.progress==null?null:Number(event.progress);
        send(requestId,'progress',{stage:String(event.status||'downloading').slice(0,40),percent:Number.isFinite(n)?Math.min(100,Math.max(0,n)):null});
      }};
      status(requestId,'loading-feature-extractor');
      const extractor=await AutoFeatureExtractor.from_pretrained(MODEL_ID,opts);
      status(requestId,`loading-onnx-${dtype}`);
      const model=await AutoModelForCTC.from_pretrained(MODEL_ID,{...opts,dtype,device:'wasm'});
      return {extractor,model};
    })().catch(err=>{runtimePromise=null;runtimeDtype=null;throw err});
  }
  return runtimePromise;
}
self.onmessage=async({data})=>{
  if(data?.type!=='ANALYZE')return;
  const requestId=data.requestId;
  if(!Number.isSafeInteger(requestId)||requestId<1)return;
  if(analyzing){send(requestId,'error',{code:'busy',message:'El motor está ocupado.'});return}
  analyzing=true;
  try{
    const audio=data.samples, dtype=data.dtype||'q4';
    if(!['q4','fp16'].includes(dtype))throw Object.assign(new Error('Variante inválida.'),{code:'invalid-dtype'});
    if(!(audio instanceof Float32Array)||audio.length<1600||audio.length>MAX_SAMPLES||data.sampleRate!==16000)
      throw Object.assign(new Error('Audio incompatible: Float32 mono, 16 kHz, entre 0,1 y 15 s.'),{code:'invalid-audio'});
    let energy=0;
    for(const v of audio){if(!Number.isFinite(v))throw Object.assign(new Error('Audio inválido.'),{code:'invalid-audio'});energy+=v*v}
    if(Math.sqrt(energy/audio.length)<0.002)throw Object.assign(new Error('Audio muy silencioso.'),{code:'silence'});
    const {extractor,model}=await getRuntime(requestId,dtype);
    status(requestId,'inferencing');
    const started=performance.now();
    const inputs=await extractor(audio);
    const {logits}=await model(inputs);
    const result=decodeCtcLogits(logits,GRUUT_VOCAB);
    if(!result.ipaRaw.trim())throw Object.assign(new Error('No se detectaron fonemas.'),{code:'no-phonemes'});
    send(requestId,'result',{modelId:MODEL_ID,modelRevision:MODEL_REVISION,dtype,engine:'local-phoneme-ctc-experimental',ipaRaw:result.ipaRaw,sampleRate:16000,inferenceMs:Math.round(performance.now()-started),frameCount:result.frameCount,confidenceAvailable:false,phonemeScore:null});
  }catch(err){send(requestId,'error',{code:typeof err?.code==='string'?err.code:'model-failed',message:`${loadingStage}: ${String(err?.message||'Error').slice(0,350)}`})}
  finally{analyzing=false}
};
