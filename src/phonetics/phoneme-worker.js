/**
 * VOX Speak · experimental local phoneme CTC inference.
 * Fix 0.2: Hugging Face's model repo ships vocab.json but no tokenizer.json;
 * the generic ASR pipeline requests the missing tokenizer and fails before
 * downloading ONNX. We instead load the audio feature extractor + CTC model
 * directly, and decode logits with the model's exact IPA vocabulary.
 *
 * No model files are loaded until an ANALYZE message arrives. All audio
 * stays in this browser. No per-phoneme scores or confidence are invented.
 */
import { decodeCtcLogits } from './ctc-decode.js';
import { GRUUT_VOCAB } from './vocab-gruut.js';

const MODEL_ID = 'onnx-community/wav2vec2-ljspeech-gruut-ONNX';
const MODEL_REVISION = '263beb019ab71cb258a97a35b0e10db9a4ddb670';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MAX_SAMPLES = 15 * 16_000;
let runtimePromise;
let analyzing = false;
let loadingStage = 'idle';

function message(requestId, type, payload = {}) {
  self.postMessage({ requestId, type, ...payload });
}
function status(requestId, stage) {
  loadingStage = stage;
  message(requestId, 'status', { stage });
}
async function getRuntime(requestId) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      status(requestId, 'loading-library');
      const { AutoFeatureExtractor, AutoModelForCTC, env } = await import(TRANSFORMERS_CDN);
      env.backends.onnx.wasm.numThreads = 1;
      env.useBrowserCache = true;
      const options = {
        revision: MODEL_REVISION,
        progress_callback: event => {
          if (!event || typeof event !== 'object') return;
          const percentage = Number(event.progress);
          message(requestId, 'progress', {
            stage: String(event.status || 'downloading').slice(0, 40),
            percent: Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : null,
          });
        },
      };
      status(requestId, 'loading-feature-extractor');
      const extractor = await AutoFeatureExtractor.from_pretrained(MODEL_ID, options);
      status(requestId, 'loading-onnx-model');
      const model = await AutoModelForCTC.from_pretrained(MODEL_ID, {
        ...options,
        dtype: 'q4',
        device: 'wasm',
      });
      return { extractor, model };
    })().catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
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
    if (!(audio instanceof Float32Array) || audio.length < 1600 ||
        audio.length > MAX_SAMPLES || data.sampleRate !== 16_000) {
      throw Object.assign(new Error('Se requiere Float32 mono de 0,1 a 15 segundos, a 16 kHz.'), { code: 'invalid-audio' });
    }
    let energy = 0;
    for (const v of audio) {
      if (!Number.isFinite(v)) throw Object.assign(new Error('Audio no finito.'), { code: 'invalid-audio' });
      energy += v * v;
    }
    if (Math.sqrt(energy / audio.length) < 0.002) {
      throw Object.assign(new Error('Audio demasiado silencioso. Graba nuevamente.'), { code: 'silence' });
    }
    const { extractor, model } = await getRuntime(requestId);
    status(requestId, 'inferencing');
    const started = performance.now();
    const inputs = await extractor(audio);
    const { logits } = await model(inputs);
    const decoded = decodeCtcLogits(logits, GRUUT_VOCAB);
    if (!decoded.ipaRaw.trim()) {
      throw Object.assign(new Error('El modelo no devolvió fonemas IPA reconocibles.'), { code: 'no-phonemes' });
    }
    message(requestId, 'result', {
      modelId: MODEL_ID,
      modelRevision: MODEL_REVISION,
      engine: 'local-phoneme-ctc-experimental',
      ipaRaw: decoded.ipaRaw,
      sampleRate: 16_000,
      inferenceMs: Math.round(performance.now() - started),
      confidenceAvailable: false,
      phonemeScore: null,
      verifiedOnAndroid: false,
    });
  } catch (error) {
    message(requestId, 'error', {
      code: typeof error?.code === 'string' ? error.code : 'model-failed',
      message: `${loadingStage}: ${String(error?.message || 'Fallo de inferencia').slice(0, 380)}`,
    });
  } finally {
    analyzing = false;
  }
};
