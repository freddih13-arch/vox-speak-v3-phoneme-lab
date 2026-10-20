/**
 * VOX Speak — experimental IPA transcription worker (no fabricated scores).
 * No network/model loading until an ANALYZE request is received.
 * Verified model metadata: onnx-community/wav2vec2-ljspeech-gruut-ONNX.
 * Actual model inference on Android still REQUIRES real-device validation.
 */
const MODEL_ID = 'onnx-community/wav2vec2-ljspeech-gruut-ONNX';
const MODEL_REVISION = '263beb019ab71cb258a97a35b0e10db9a4ddb670';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_SAMPLES = 15 * 16_000;
let pipelinePromise;
let analyzing = false;

const message = (requestId, type, payload = {}) => {
  self.postMessage({ requestId, type, ...payload });
};

async function getPipeline(requestId) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      message(requestId, 'status', { stage: 'loading-library' });
      const { pipeline, env } = await import(TRANSFORMERS_CDN);
      // Cross-origin isolated headers are not supplied by GitHub Pages;
      // one WASM thread avoids SharedArrayBuffer requirements.
      env.backends.onnx.wasm.numThreads = 1;
      env.useBrowserCache = true;
      message(requestId, 'status', { stage: 'loading-model' });
      return await pipeline('automatic-speech-recognition', MODEL_ID, {
        revision: MODEL_REVISION,
        dtype: 'q4',
        device: 'wasm',
        progress_callback: (p) => {
          if (!p || typeof p !== 'object') return;
          const percent = Number(p.progress);
          // Do not emit URLs, credentials, model binary or user audio.
          message(requestId, 'progress', {
            stage: String(p.status || 'loading').slice(0, 40),
            percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
          });
        },
      });
    })().catch(error => {
      pipelinePromise = null; // allow explicit retry after a failed download
      throw error;
    });
  }
  return pipelinePromise;
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'ANALYZE') return;
  const requestId = data.requestId;
  if (!Number.isSafeInteger(requestId) || requestId < 1) return;
  if (analyzing) {
    message(requestId, 'error', { code: 'busy', message: 'El motor está analizando otra frase.' });
    return;
  }
  analyzing = true;
  try {
    const audio = data.samples;
    if (!(audio instanceof Float32Array) || audio.length < 1600 || audio.length > MAX_SAMPLES || data.sampleRate !== 16_000) {
      throw Object.assign(new Error('Se requieren muestras Float32 mono a 16 kHz, de 0,1 a 15 segundos.'), { code: 'invalid-audio' });
    }
    let sum = 0;
    for (const v of audio) {
      if (!Number.isFinite(v)) throw Object.assign(new Error('La señal contiene datos inválidos.'), { code: 'invalid-audio' });
      sum += v * v;
    }
    if (Math.sqrt(sum / audio.length) < 0.002) {
      throw Object.assign(new Error('El audio es demasiado silencioso; graba de nuevo.'), { code: 'silence' });
    }
    const model = await getPipeline(requestId);
    message(requestId, 'status', { stage: 'inferencing' });
    const started = performance.now();
    const result = await model(audio);
    if (typeof result?.text !== 'string' || !result.text.trim()) {
      throw Object.assign(new Error('El modelo no devolvió fonemas reconocibles.'), { code: 'no-phonemes' });
    }
    message(requestId, 'result', {
      modelId: MODEL_ID,
      modelRevision: MODEL_REVISION,
      engine: 'local-phoneme-experimental',
      ipaRaw: result.text.trim(),
      sampleRate: 16_000,
      inferenceMs: Math.round(performance.now() - started),
      // No confidence or articulation score is available from this pipeline.
      confidenceAvailable: false,
      phonemeScore: null,
      verifiedOnAndroid: false,
    });
  } catch (error) {
    message(requestId, 'error', {
      code: typeof error?.code === 'string' ? error.code : 'model-failed',
      message: String(error?.message || 'No se pudo procesar la frase.').slice(0, 280),
    });
  } finally {
    analyzing = false;
  }
};
