import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../lab.js',import.meta.url),'utf8');
test('two human LibriSpeech controls have transcript-matched selection and provenance',()=>{
  for(const [id,transcript] of [['2277-149896-0004','How would the papers talk about it?'],['2277-149896-0012','She had not been able to get away this morning.']]) {
    assert.ok(js.includes(id));assert.ok(html.includes(transcript));
  }
  assert.match(html,/CC BY 4\.0/);assert.match(html,/nacionalidad|Nacionalidad/);
  assert.match(html,/data-human-control="0"/);assert.match(html,/data-human-control="1"/);
  assert.match(js,/phrase.value=control.transcript/);
  assert.match(js,/no se calcula distancia/);
});
test('human control must be local WAV from same origin and not auto-download model',()=>{
  assert.match(js,/fetch\('\.\/'\+control.file\)/);
  assert.match(js,/RIFF/);assert.match(js,/WAVE/);
  assert.doesNotMatch(html,/<script[^>]+transformers/i);
  assert.match(js,/runVariant\(prepared,'q4','Q4 · ejecución 1'\)/);
});
