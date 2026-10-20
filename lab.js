/** VOX benchmark 0.4: human LibriSpeech controls, same PCM Q4 x2, optional FP16.
 * Never interprets IPA edit distance as pronunciation quality.
 */
import {prepareRecordedAudio} from './src/phonetics/audio-processor.js';
import {LocalPhonemeEngine} from './src/phonetics/phonemes-local.js?v=benchmark-v3';
import {REFERENCE_TOKENS,tokenize,tokenEditDistance,repeatedOutputsMatch} from './src/phonetics/benchmark-analysis.js';
const $=id=>document.getElementById(id), now=()=>performance.now();
const record=$('record'),stop=$('stop'),upload=$('upload'),analyze=$('analyze'),state=$('state');
const recordStatus=$('record-status'),playback=$('playback'),progress=$('progress'),ipa=$('ipa'),copy=$('copy'),phrase=$('phrase');

let recorder=null,stream=null,audioBlob=null,chunks=[],playbackUrl=null,engine=null,recordTimer=null,startedAt=0,processing=false,controller=null;
let source='Grabación propia', lastRuns=[], lastHash='', lastPrepMs=null, lastDuration=null;
const HUMAN_CONTROLS = Object.freeze([
 {file:'reference-librispeech-2277-149896-0004.wav',transcript:'How would the papers talk about it?',speaker:'2277',id:'2277-149896-0004'},
 {file:'reference-librispeech-2277-149896-0012.wav',transcript:'She had not been able to get away this morning.',speaker:'2277',id:'2277-149896-0012'},
]);
let loadingControl=false;
function setControlBusy(value){
 loadingControl=value;
 for(const el of document.querySelectorAll('[data-human-control]'))el.disabled=value||processing;
 $('reference').disabled=value||processing;
 record.disabled=value||processing;
 upload.disabled=value||processing;
 analyze.disabled=value||processing||!audioBlob;
}

const fmt=v=>Number.isFinite(v)?`${Math.round(v)} ms`:'—';
const err=e=>`[${e?.code||e?.name||'error'}] ${e?.message||'Error no especificado'}`;
function busy(v){processing=v;record.disabled=v||loadingControl;upload.disabled=v||loadingControl;analyze.disabled=v||loadingControl||!audioBlob;$('reference').disabled=v||loadingControl;for(const el of document.querySelectorAll('[data-human-control]'))el.disabled=v||loadingControl;stop.disabled=v||!recorder||recorder.state!=='recording';$('cancel').hidden=!v}
function clearResults(){lastRuns=[];lastHash='';ipa.textContent='—';copy.disabled=true;$('comparison').replaceChildren();$('dur').textContent='—';$('prep').textContent='—';$('load').textContent='—';$('infer').textContent='—';$('technical').textContent='No hay puntuación de pronunciación. Una distancia de edición es solo una discrepancia textual.';}
function setAudio(blob,kind){if(playbackUrl)URL.revokeObjectURL(playbackUrl);playbackUrl=URL.createObjectURL(blob);playback.src=playbackUrl;playback.hidden=false;audioBlob=blob;source=kind;analyze.disabled=false;clearResults();state.textContent='Audio listo. Se utilizará el mismo archivo en todas las ejecuciones del benchmark.'}
phrase.addEventListener('change',()=>{$('prompt').textContent=`Di en inglés: “${phrase.value}”`;clearResults()});
upload.addEventListener('change',()=>{if(upload.files?.length){setAudio(upload.files[0],'Archivo local proporcionado por usuario');recordStatus.textContent=`Audio cargado: ${upload.files[0].name}`}});
$('reference').addEventListener('click',async()=>{
  if(processing)return;
  phrase.value='I work in sales.';phrase.dispatchEvent(new Event('change'));
  recordStatus.textContent='Cargando control sintético creado con eSpeak, NO voz humana nativa…';
  try{const r=await fetch('./reference-espeak-en-us.wav');if(!r.ok)throw new Error('HTTP '+r.status);const blob=await r.blob();if(!blob.size)throw new Error('Archivo vacío');setAudio(blob,'Voz sintética eSpeak (control, no nativo)');recordStatus.textContent='Control sintético listo. Puedes escucharlo antes de analizar.'}catch(e){recordStatus.textContent='Error al cargar referencia: '+e.message}
});
// A source transcript is NOT an acoustic phoneme reference, so human samples
// deliberately have no inferred IPA edit-distance/quality score.
for(const button of document.querySelectorAll('[data-human-control]')){
 button.addEventListener('click',async()=>{
  if(processing||loadingControl)return;
  const control=HUMAN_CONTROLS[Number(button.dataset.humanControl)];
  if(!control)return;
  setControlBusy(true);
  recordStatus.textContent='Cargando grabación humana LibriSpeech (CC BY 4.0)…';
  try{
   const response=await fetch('./'+control.file);
   if(!response.ok)throw new Error('HTTP '+response.status);
   const blob=await response.blob();
   if(blob.size<12000||blob.size>2_000_000)throw new Error('Tamaño inesperado del WAV de referencia.');
   const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());
   const ascii=bytes=>String.fromCharCode(...bytes);
   if(ascii(header.slice(0,4))!=='RIFF'||ascii(header.slice(8,12))!=='WAVE')throw new Error('Archivo WAV inválido.');
   phrase.value=control.transcript;
   phrase.dispatchEvent(new Event('change'));
   setAudio(blob,`Voz humana LibriSpeech dev-clean ${control.id} (CC BY 4.0; hablante de lectura, nacionalidad no verificada)`);
   recordStatus.textContent=`Control humano ${control.id} listo. Escucha la grabación y después analiza Q4; no tiene IPA de referencia validada.`;
  }catch(error){recordStatus.textContent='Error al cargar voz humana: '+error.message}
  finally{setControlBusy(false)}
 });
}
async function finishRecording(){if(!recorder||recorder.state==='inactive')return;stop.disabled=true;record.disabled=true;if(recordTimer)clearTimeout(recordTimer);try{recorder.requestData?.();recorder.stop()}catch(e){recordStatus.textContent=err(e)}}
record.addEventListener('click',async()=>{
 if(processing||loadingControl)return;record.disabled=true;recordStatus.textContent='Solicitando micrófono…';
 try{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Micrófono no disponible; abre en Chrome por HTTPS.');
 stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
 const types=['audio/webm;codecs=opus','audio/webm','audio/mp4'];const mime=types.find(m=>MediaRecorder.isTypeSupported(m));chunks=[];
 const r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorder=r;
 r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 r.onstop=()=>{if(recordTimer)clearTimeout(recordTimer);stream?.getTracks().forEach(t=>t.stop());stream=null;const blob=new Blob(chunks,{type:r.mimeType||'audio/webm'});
 if(blob.size){setAudio(blob,'Grabación propia');recordStatus.textContent=`Grabación lista (${((now()-startedAt)/1000).toFixed(1)} segundos). Reproduce y analiza.`}else recordStatus.textContent='La grabación quedó vacía.';record.disabled=false;stop.disabled=true};
 r.onerror=e=>{recordStatus.textContent='MediaRecorder '+err(e.error||e)};
 startedAt=now();r.start(250);stop.disabled=false;recordStatus.textContent='🎙 Grabando. Di la frase y detén.';recordTimer=setTimeout(finishRecording,10000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;record.disabled=false;recordStatus.textContent=err(e)}
});
stop.addEventListener('click',finishRecording);
async function hashSamples(samples){const bytes=new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength);const result=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16)}
function paintRuns(){const container=$('comparison');container.replaceChildren();const expected=REFERENCE_TOKENS[phrase.value]||[];
 const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;font-size:.84rem';
 const h=document.createElement('tr');['Variante','IPA detectada','Distancia*','Inferencia'].forEach(x=>{const th=document.createElement('th');th.textContent=x;th.style.cssText='text-align:left;padding:8px 4px;border-bottom:1px solid #536780';h.append(th)});table.append(h);
 for(const run of lastRuns){const row=document.createElement('tr');for(const v of [run.name,run.ipaRaw||('Error: '+run.error),Number.isInteger(run.distance)?String(run.distance):'—',fmt(run.inferenceMs)]){const c=document.createElement('td');c.textContent=v;c.style.cssText='padding:8px 4px;border-bottom:1px solid #334560;vertical-align:top;overflow-wrap:anywhere';row.append(c)}table.append(row)}
 container.append(table);const legend=document.createElement('p');legend.className='muted';legend.textContent='* Distancia solo disponible para frases con referencia IPA aproximada. Para voces humanas LibriSpeech NO asignamos distancia ni nota sin una referencia fonética validada. No mide pronunciación.';container.append(legend);
 const q4=lastRuns.filter(x=>x.dtype==='q4'&&x.ipaRaw);if(q4.length===2){const note=document.createElement('p');note.className='muted';note.textContent=`Repetibilidad Q4 (mismo PCM): ${repeatedOutputsMatch(q4[0],q4[1])?'idéntica':'diferente (revisar no determinismo)'}. SHA-256 PCM: ${lastHash}`;container.append(note)}
 const last=lastRuns.findLast(x=>x.ipaRaw);ipa.textContent=last?.ipaRaw||'—';copy.disabled=!lastRuns.length;
}
async function runVariant(prepared,dtype,name){
  let started=now(),inferenceStart=null;
  state.textContent=`Preparando ${name}. Mantén Chrome en primer plano.`;progress.hidden=true;progress.value=0;
  if(!engine||engine.dtype!==dtype){engine?.dispose();engine=new LocalPhonemeEngine({timeoutMs:300000,dtype})}
  try{
    const result=await engine.analyze(prepared,{signal:controller.signal,onProgress: info=>{
      if(info.stage==='inferencing'){inferenceStart=now();$('load').textContent=fmt(inferenceStart-started)}
      else {const n=info.percent==null?NaN:Number(info.percent);if(Number.isFinite(n)){progress.hidden=false;progress.value=n};state.textContent=`${name}: ${info.stage||info.type}${Number.isFinite(n)?' · '+Math.round(n)+'%':''}. Mantén Chrome abierto.`}
    }});
    const expected=REFERENCE_TOKENS[phrase.value]||[];const actual=tokenize(result.ipaRaw);
    const entry={name,dtype,ipaRaw:result.ipaRaw,inferenceMs:result.inferenceMs,initializationMs:(inferenceStart||now())-started,distance:expected.length?tokenEditDistance(expected,actual):null,tokenCount:actual.length};lastRuns.push(entry);$('infer').textContent=fmt(result.inferenceMs);$('load').textContent=fmt(entry.initializationMs);paintRuns();return entry;
  }catch(e){if(e.code==='aborted')throw e;const entry={name,dtype,error:err(e),inferenceMs:null,distance:null};lastRuns.push(entry);paintRuns();engine?.dispose();engine=null;state.textContent=`${name}: ${entry.error}. Se continuará con otras pruebas si es posible.`;return entry}
}
analyze.addEventListener('click',async()=>{
 if(!audioBlob||processing||loadingControl)return;busy(true);clearResults();controller=new AbortController();let stopped=false;
 try{
   state.textContent='Convirtiendo una sola vez el audio a mono 16 kHz…';const start=now();const prepared=await prepareRecordedAudio(audioBlob);lastPrepMs=now()-start;lastDuration=prepared.durationSeconds;
   $('dur').textContent=lastDuration.toFixed(2)+' s';$('prep').textContent=fmt(lastPrepMs);lastHash=await hashSamples(prepared.samples);
   await runVariant(prepared,'q4','Q4 · ejecución 1');
   if(controller.signal.aborted)throw Object.assign(new Error('Cancelado'),{code:'aborted'});
   await runVariant(prepared,'q4','Q4 · repetición exacta');
   if(controller.signal.aborted)throw Object.assign(new Error('Cancelado'),{code:'aborted'});
   if($('enable-fp16').checked){
     engine?.dispose();engine=null;
     await runVariant(prepared,'fp16','FP16 · opcional (189 MB)');
   }
   if(controller.signal.aborted)throw Object.assign(new Error('Cancelado'),{code:'aborted'});
   state.textContent=lastRuns.some(r=>r.error)?'⚠️ Benchmark terminado con errores de modelo; revisa las filas y copia el informe.':'✅ Benchmark terminado. Resultados experimentales, sin nota de pronunciación. Revisa la tabla y copia el informe.';
 }catch(e){stopped=true;state.textContent='⚠️ Benchmark interrumpido: '+err(e)}
 finally{engine?.dispose();engine=null;controller=null;busy(false);copy.disabled=!lastRuns.length}
});
$('cancel').addEventListener('click',()=>{controller?.abort();engine?.dispose();engine=null;state.textContent='Cancelando análisis…'});
copy.addEventListener('click',async()=>{
 const report=['VOX Speak · benchmark fonético v0.4','Audio: '+source,'Frase objetivo: '+phrase.value,'Referencia IPA aproximada (solo si está disponible): '+((REFERENCE_TOKENS[phrase.value]||[]).join(' ')||'Sin referencia IPA verificada para audio humano; no se calcula distancia'),'Huella SHA-256 (16 hex) del mismo audio PCM: '+lastHash,'Duración: '+(lastDuration?.toFixed(2)||'—')+' s','Preparación: '+fmt(lastPrepMs),...lastRuns.map(r=>r.name+': '+(r.ipaRaw||r.error)+' | distancia textual no calibrada: '+(r.distance??'—')+' | inferencia: '+fmt(r.inferenceMs)),'Navegador: '+navigator.userAgent.slice(0,150),'Grabación humana de LibriSpeech dev-clean, licencia CC BY 4.0 y transcript literal, si se seleccionó ese control. Sin audio privado, claves ni información personal adjunta. No equivale a evaluación de pronunciación.'].join('\n');
 try{await navigator.clipboard.writeText(report);state.textContent='Informe copiado. Pégalo en el chat.'}catch{const pre=document.createElement('pre');pre.textContent=report;$('comparison').append(pre);state.textContent='No se pudo copiar automáticamente; selecciona el informe mostrado.'}
});
addEventListener('pagehide',()=>{controller?.abort();engine?.dispose();if(recordTimer)clearTimeout(recordTimer);stream?.getTracks().forEach(t=>t.stop());if(playbackUrl)URL.revokeObjectURL(playbackUrl)})
