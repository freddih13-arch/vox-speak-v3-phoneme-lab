import { prepareRecordedAudio } from './src/phonetics/audio-processor.js';
import { LocalPhonemeEngine } from './src/phonetics/phonemes-local.js?v=ctc-v2';
const $ = id => document.getElementById(id);
const record = $('record'), stop = $('stop'), upload = $('upload'), analyze = $('analyze');
const state = $('state'), recordStatus = $('record-status'), playback = $('playback'), progress = $('progress');
const ipa = $('ipa'), copy = $('copy'), phrase = $('phrase');
let recorder = null, stream = null, recordedBlob = null, recordingChunks = [], playbackUrl = null;
let engine = null, recordingTimer = null, startedAt = 0, processing = false;
let metrics = { duration: null, preparationMs: null, initializationMs: null, inferenceMs: null, model: '' };
const now = () => performance.now();
const fmt = n => Number.isFinite(n) ? `${Math.round(n)} ms` : '—';
const err = e => `[${e.code || e.name || 'unknown'}] ${e.message || 'Error desconocido'}`;
function setBusy(b) { processing=b; analyze.disabled=b||!recordedBlob; record.disabled=b; upload.disabled=b; stop.disabled=b || !recorder || recorder.state!=='recording'; }
function setAudio(blob) {
  if(playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl=URL.createObjectURL(blob); playback.src=playbackUrl;playback.hidden=false;
  recordedBlob=blob; analyze.disabled=false;
  ipa.textContent='—'; copy.disabled=true; $('dur').textContent='—'; $('prep').textContent='—'; $('load').textContent='—'; $('infer').textContent='—';
  state.textContent='Audio recibido. Pulsa «Analizar fonemas» para descargar/cargar el modelo.';
}
phrase.addEventListener('change',()=>{$('prompt').textContent=`Di en inglés: “${phrase.value}”`});
upload.addEventListener('change',()=>{
  if(upload.files?.length){setAudio(upload.files[0]);recordStatus.textContent=`Archivo listo: ${upload.files[0].name}.`}
});
async function finishRecording(){
  if(!recorder||recorder.state==='inactive')return;
  stop.disabled=true;record.disabled=true;
  if(recordingTimer) clearTimeout(recordingTimer);
  try{recorder.requestData?.();recorder.stop()}catch(e){recordStatus.textContent=err(e)}
}
record.addEventListener('click',async()=>{
  if(processing)return;
  record.disabled=true;recordStatus.textContent='Solicitando permiso de micrófono…';
  try{
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)throw new Error('Chrome no admite MediaRecorder o getUserMedia en esta página. Comprueba HTTPS.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const candidates=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    const mime=candidates.find(m=>MediaRecorder.isTypeSupported(m));
    recordingChunks=[];
    const r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);recorder=r;
    r.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};
    r.onstop=()=>{
      if(recordingTimer)clearTimeout(recordingTimer);
      stream?.getTracks().forEach(t=>t.stop());stream=null;
      const blob=new Blob(recordingChunks,{type:r.mimeType||'audio/webm'});
      if(blob.size){setAudio(blob);recordStatus.textContent=`Grabación lista (${((now()-startedAt)/1000).toFixed(1)} s). Escúchala y pulsa analizar.`}
      else recordStatus.textContent='La grabación quedó vacía; intenta otra vez.';
      record.disabled=false;stop.disabled=true;
    };
    r.onerror=e=>{recordStatus.textContent='MediaRecorder: '+err(e.error||e)};
    startedAt=now();r.start(250);
    stop.disabled=false;
    recordStatus.textContent='🎙 Grabando. Pronuncia la frase y pulsa «Detener».';
    recordingTimer=setTimeout(finishRecording,10_000);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;record.disabled=false;recordStatus.textContent='No se pudo grabar: '+err(e)}
});
stop.addEventListener('click',finishRecording);
analyze.addEventListener('click',async()=>{
  if(!recordedBlob||processing)return;
  setBusy(true); progress.hidden=true;progress.value=0;ipa.textContent='—';copy.disabled=true;
  let mark=now(), inferenceStartedAt=null;
  try{
    state.textContent='Decodificando y convirtiendo a 16 kHz…';
    const prepared=await prepareRecordedAudio(recordedBlob);
    metrics.duration=prepared.durationSeconds;metrics.preparationMs=now()-mark;
    $('dur').textContent=`${prepared.durationSeconds.toFixed(2)} s`;$('prep').textContent=fmt(metrics.preparationMs);
    state.textContent='Cargando motor (la primera descarga puede tardar)…';
    engine ??= new LocalPhonemeEngine({timeoutMs:240_000});
    mark=now();inferenceStartedAt=null;
    const response=await engine.analyze(prepared,{onProgress:info=>{
      if(info.stage==='inferencing'){inferenceStartedAt=now();metrics.initializationMs=inferenceStartedAt-mark;$('load').textContent=fmt(metrics.initializationMs);}
      else {let pct=info.percent==null?NaN:Number(info.percent);if(Number.isFinite(pct)){progress.hidden=false;progress.value=pct}state.textContent=`Motor: ${info.stage||info.type}${Number.isFinite(pct)?' · '+Math.round(pct)+'%':''}. Mantén la pantalla activa.`}
    }});
    metrics.inferenceMs=response.inferenceMs;metrics.model=response.modelId;
    if(!Number.isFinite(metrics.initializationMs))metrics.initializationMs=now()-mark-response.inferenceMs;
    $('load').textContent=fmt(metrics.initializationMs);$('infer').textContent=fmt(metrics.inferenceMs);
    ipa.textContent=response.ipaRaw;
    state.textContent='✅ Inferencia ONNX completada en tu navegador. Resultado experimental, sin nota de pronunciación.';
    $('technical').textContent=`Motor local · ${response.modelId} · sin confianza calibrada. No compara todavía fonemas esperados/detectados.`;
    copy.disabled=false;
  }catch(e){state.textContent='⚠️ Error de la prueba: '+err(e)+'. Puedes volver a intentarlo.';if(engine&&['worker-error','timeout','model-failed','worker-unavailable'].includes(e.code)){engine.dispose();engine=null}}
  finally{setBusy(false)}
});
copy.addEventListener('click',async()=>{
  const report=['VOX Speak · resultado laboratorio fonético','Frase de referencia: '+phrase.value,'Fonemas reconocidos (experimental): '+ipa.textContent,'Motor: '+(metrics.model||'no finalizado'),'Duración audio: '+(metrics.duration?.toFixed(2)||'—')+' s','Preparación: '+fmt(metrics.preparationMs),'Carga/inicialización: '+fmt(metrics.initializationMs),'Inferencia: '+fmt(metrics.inferenceMs),'Navegador: '+navigator.userAgent.slice(0,190),'No incluye grabaciones, archivos ni claves.'].join('\n');
  try{await navigator.clipboard.writeText(report);state.textContent='Informe copiado: puedes pegarlo en nuestro chat.'}catch{state.textContent='No se pudo copiar automáticamente. Selecciona el texto IPA y el mensaje de tiempos.'}
});
addEventListener('pagehide',()=>{if(recordingTimer)clearTimeout(recordingTimer);stream?.getTracks().forEach(t=>t.stop());if(playbackUrl)URL.revokeObjectURL(playbackUrl);engine?.dispose()});
