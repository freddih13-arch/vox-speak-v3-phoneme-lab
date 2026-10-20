/**
 * Lazy client of phoneme-worker.js. Vanilla ES modules, no bundler.
 * No worker, Transformers.js module, or model is loaded until analyze() call.
 * Consumes prepareRecordedAudio(...) output; returns raw IPA, NEVER fake score.
 */
export class LocalPhonemeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalPhonemeError';
    this.code = code;
  }
}

export class LocalPhonemeEngine {
  constructor({
    workerFactory = () => new Worker(new URL('./phoneme-worker.js', import.meta.url), { type: 'module' }),
    timeoutMs = 180_000,
  } = {}) {
    this.workerFactory = workerFactory;
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
  }

  #ensureWorker() {
    if (this.worker) return;
    if (typeof this.workerFactory !== 'function') throw new LocalPhonemeError('unsupported', 'Web Worker no está disponible.');
    let worker;
    try { worker = this.workerFactory(); }
    catch (error) { throw new LocalPhonemeError('worker-unavailable', `No se pudo iniciar el motor local: ${error.message}`); }
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (!data || !this.pending.has(data.requestId)) return;
      const p = this.pending.get(data.requestId);
      if (data.type === 'status' || data.type === 'progress') {
        try { p.onProgress?.(data); } catch (_) { /* progress is informational */ }
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(data.requestId);
      p.signal?.removeEventListener('abort', p.onAbort);
      if (data.type === 'result') p.resolve(data);
      else p.reject(new LocalPhonemeError(data.code || 'worker-error', data.message || 'El modelo no respondió.'));
    };
    worker.onerror = (event) => {
      this.#failAll('worker-error', `Error al cargar el modelo local: ${event.message || 'desconocido'}`);
    };
    worker.onmessageerror = () => this.#failAll('message-error', 'No se recibió correctamente el resultado del worker.');
  }

  #failAll(code, message) {
    const pendings = [...this.pending.values()];
    this.pending.clear();
    for (const p of pendings) {
      clearTimeout(p.timer);
      p.signal?.removeEventListener('abort', p.onAbort);
      p.reject(new LocalPhonemeError(code, message));
    }
    this.worker?.terminate();
    this.worker = null;
  }

  /**
   * @param {{samples:Float32Array,sampleRate:number}} processed output of prepareRecordedAudio
   * @param {{onProgress?:(message:object)=>void,signal?:AbortSignal}} options
   */
  analyze(processed, { onProgress, signal } = {}) {
    if (processed?.sampleRate !== 16_000 || !(processed?.samples instanceof Float32Array)) {
      return Promise.reject(new LocalPhonemeError('invalid-audio', 'Primero convierte el audio a Float32 mono / 16 kHz.'));
    }
    if (signal?.aborted) return Promise.reject(new LocalPhonemeError('aborted', 'Análisis cancelado.'));
    try { this.#ensureWorker(); }
    catch (error) { return Promise.reject(error); }
    const requestId = ++this.seq;
    // Transfer a private copy; keep original audio and WAV usable by the UI.
    const copied = new Float32Array(processed.samples);
    return new Promise((resolve, reject) => {
      const onAbort = () => this.#failAll('aborted', 'Análisis cancelado.');
      const timer = setTimeout(() => this.#failAll('timeout', 'El motor local tardó demasiado. Reintenta o usa una frase más corta.'), this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, signal, onAbort, onProgress });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { this.worker.postMessage({ type: 'ANALYZE', requestId, samples: copied, sampleRate: 16_000 }, [copied.buffer]); }
      catch (error) { this.#failAll('post-message', `No pude enviar el audio al modelo: ${error.message}`); }
    });
  }

  dispose() { this.#failAll('disposed', 'Se cerró el motor fonético local.'); }
}
