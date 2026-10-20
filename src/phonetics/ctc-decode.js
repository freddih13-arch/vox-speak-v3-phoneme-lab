/**
 * Greedy CTC decoding for LJSpeech Gruut phoneme logits.
 * The model outputs frame logits [1, time, vocab]. CTC merges consecutive
 * repeated IDs BEFORE removing its blank token. A repeated token separated
 * by a blank represents two actual tokens.
 *
 * These tokens are IPA phonemes, not calibrated pronunciation scores.
 */
export function decodeCtcLogits(logits, vocab) {
  const dims = logits?.dims;
  const data = logits?.data;
  if (!Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1 ||
      !Number.isInteger(dims[1]) || dims[1] < 1 ||
      !Number.isInteger(dims[2]) || dims[2] < 2 ||
      !data || data.length !== dims[1] * dims[2]) {
    throw new Error('El modelo devolvió logits CTC con dimensiones inesperadas.');
  }
  const [ , frames, classes ] = dims;
  const idToToken = new Array(classes);
  for (const [token, id] of Object.entries(vocab)) {
    if (!Number.isSafeInteger(id) || id < 0 || id >= classes) {
      throw new Error('El vocabulario no coincide con la salida del modelo.');
    }
    idToToken[id] = token;
  }
  if (Array.from({length: classes}, (_, i) => idToToken[i]).some(x => typeof x !== 'string')) {
    throw new Error('Al vocabulario IPA le faltan símbolos para este modelo.');
  }
  const blank = vocab['[PAD]'];
  if (!Number.isInteger(blank)) throw new Error('Falta el token CTC [PAD].');

  let previous = -1;
  const tokens = [];
  for (let t = 0; t < frames; t++) {
    const offset = t * classes;
    let best = -Infinity, bestId = -1;
    for (let c = 0; c < classes; c++) {
      const score = data[offset + c];
      if (!Number.isFinite(score)) throw new Error('La salida ONNX contiene valores no finitos.');
      if (score > best) { best = score; bestId = c; }
    }
    if (bestId !== previous && bestId !== blank) {
      const value = idToToken[bestId];
      if (value === '|') tokens.push('|');
      else if (!value.startsWith('[') && !value.startsWith('<')) tokens.push(value);
      else if (value === '[UNK]') tokens.push('?');
    }
    previous = bestId;
  }
  const words = [];
  let word = [];
  for (const token of tokens) {
    if (token === '|') {
      if (word.length) words.push(word.join(' '));
      word = [];
    } else { word.push(token); }
  }
  if (word.length) words.push(word.join(' '));
  return { ipaRaw: words.join('  '), tokens, frameCount: frames, confidenceAvailable: false };
}
