/**
 * VOX Speak · Fase fonética local 0.1 — audio-processor.js
 * Transform a complete recorded Blob into mono 16 kHz Float32 PCM.
 * No speech recognition, Azure, model loading, storage or scores occur here.
 *
 * MediaRecorder on Chrome Android typically returns audio/webm (Opus).
 * decodeAudioData decodes the COMPLETE recording; a windowed-sinc resampler
 * reduces aliasing when changing from 44.1/48 kHz to 16 kHz.
 */
export const TARGET_SAMPLE_RATE = 16_000;
export const MAX_DURATION_SECONDS = 15;
export const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const SAMPLE_RATE_MIN = 4_000;
const SAMPLE_RATE_MAX = 192_000;

export class AudioProcessingError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AudioProcessingError';
    this.code = code;
  }
}

/** @returns {Float32Array} channel-averaged, non-mutating mono samples */
export function downmixChannels(channels) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 8) {
    throw new AudioProcessingError('invalid-channels', 'Se necesita una grabación de 1 a 8 canales.');
  }
  const count = channels[0]?.length;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new AudioProcessingError('empty-audio', 'No se recibieron muestras de audio.');
  }
  const output = new Float32Array(count);
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== count) {
      throw new AudioProcessingError('invalid-channels', 'Los canales de audio no son compatibles.');
    }
    for (let i = 0; i < count; i++) {
      if (!Number.isFinite(channel[i])) {
        throw new AudioProcessingError('invalid-audio', 'Se recibieron muestras de audio no válidas.');
      }
      output[i] += channel[i] / channels.length;
    }
  }
  return output;
}

/**
 * Windowed sinc, quality-focused small-clip resampler, with normalized taps.
 * This is deterministic and works independently of OfflineAudioContext.
 * Downsampling applies a low-pass cutoff to suppress aliases.
 */
export function resampleMono(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || samples.length < 1) {
    throw new AudioProcessingError('empty-audio', 'No hay muestras para convertir.');
  }
  if (![sourceRate, targetRate].every(rate => Number.isFinite(rate) && rate >= SAMPLE_RATE_MIN && rate <= SAMPLE_RATE_MAX)) {
    throw new AudioProcessingError('invalid-rate', 'La frecuencia de muestreo es inválida.');
  }
  const duration = samples.length / sourceRate;
  if (duration > MAX_DURATION_SECONDS) {
    throw new AudioProcessingError('too-long', `La frase supera ${MAX_DURATION_SECONDS} segundos. Graba una frase más corta.`);
  }
  if (sourceRate === targetRate) return new Float32Array(samples);

  const length = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const out = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  const cutoff = Math.min(1, targetRate / sourceRate) * 0.94;
  const radius = 20; // 41 taps per output sample; good tradeoff for short speech.
  for (let i = 0; i < length; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const base = Math.floor(center);
    let weighted = 0, weights = 0;
    for (let j = base - radius + 1; j <= base + radius; j++) {
      if (j < 0 || j >= samples.length) continue;
      const dist = center - j;
      const x = Math.PI * dist * cutoff;
      const sinc = Math.abs(x) < 1e-10 ? 1 : Math.sin(x) / x;
      const window = 0.5 + 0.5 * Math.cos(Math.PI * dist / radius);
      const weight = cutoff * sinc * window;
      weighted += samples[j] * weight;
      weights += weight;
    }
    out[i] = weights === 0 ? 0 : Math.max(-1, Math.min(1, weighted / weights));
  }
  return out;
}

export function analyzeSignal(samples) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new AudioProcessingError('empty-audio', 'La señal está vacía.');
  }
  let squares = 0, peak = 0, clipped = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) throw new AudioProcessingError('invalid-audio', 'El audio contiene datos no válidos.');
    const abs = Math.abs(value);
    squares += value * value;
    peak = Math.max(peak, abs);
    if (abs >= 0.995) clipped++;
  }
  const rms = Math.sqrt(squares / samples.length);
  return { rms, peak, clippingRatio: clipped / samples.length, probablySilent: rms < 0.002 };
}

/**
 * Future Azure-compatible PCM16 RIFF/WAVE; the local model uses Float32Array.
 * A WAV does not contain float32 samples here: it contains signed 16-bit PCM.
 */
export function encodePcm16Wav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new AudioProcessingError('empty-audio', 'No hay audio que exportar.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < SAMPLE_RATE_MIN || sampleRate > SAMPLE_RATE_MAX || samples.length > 10_000_000) {
    throw new AudioProcessingError('invalid-rate', 'Parámetros WAV inválidos.');
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const chars = (at, text) => { for (let i = 0; i < text.length; i++) v.setUint8(at + i, text.charCodeAt(i)); };
  chars(0, 'RIFF'); v.setUint32(4, buffer.byteLength - 8, true); chars(8, 'WAVE');
  chars(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  chars(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!Number.isFinite(s)) throw new AudioProcessingError('invalid-audio', 'Muestras WAV inválidas.');
    const c = Math.max(-1, Math.min(1, s));
    v.setInt16(44 + i * 2, c < 0 ? Math.round(c * 32768) : Math.round(c * 32767), true);
  }
  return buffer;
}

/**
 * @param {Blob} blob Complete MediaRecorder recording, not an individual chunk.
 * @param {{ rejectSilence?: boolean }} options
 * @returns {Promise<{ samples: Float32Array, sampleRate:16000, durationSeconds:number, signal:object, wav:ArrayBuffer, sourceSampleRate:number }>}
 */
export async function prepareRecordedAudio(blob, { rejectSilence = true } = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new AudioProcessingError('empty-recording', 'No hay grabación para analizar.');
  }
  if (blob.size > MAX_BLOB_BYTES) {
    throw new AudioProcessingError('too-large', 'La grabación ocupa demasiado espacio.');
  }
  const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextType) {
    throw new AudioProcessingError('unsupported', 'Este navegador no permite decodificar audio.');
  }
  const context = new AudioContextType();
  let audio;
  try {
    // WebAudio decodes complete WebM/Opus or another format supported by Chrome.
    audio = await context.decodeAudioData(await blob.arrayBuffer());
  } catch (cause) {
    throw new AudioProcessingError('decode-failed', 'No se pudo decodificar la grabación. Prueba Chrome actualizado.', cause);
  } finally {
    try { await context.close(); } catch (_) { /* browser may already be closed */ }
  }
  if (!audio || audio.numberOfChannels < 1 || audio.duration > MAX_DURATION_SECONDS) {
    throw new AudioProcessingError(audio?.duration > MAX_DURATION_SECONDS ? 'too-long' : 'empty-audio', 'La grabación está vacía o supera el límite de 15 segundos.');
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const mono = downmixChannels(channels);
  const samples = resampleMono(mono, audio.sampleRate);
  const signal = analyzeSignal(samples);
  if (rejectSilence && signal.probablySilent) {
    throw new AudioProcessingError('silence', 'La grabación está demasiado silenciosa para un análisis fiable.');
  }
  return {
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    sourceSampleRate: audio.sampleRate,
    durationSeconds: samples.length / TARGET_SAMPLE_RATE,
    signal,
    wav: encodePcm16Wav(samples),
  };
}
