import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../lab.js',import.meta.url),'utf8');
test('benchmark controls for reference audio, recording, FP16 are rendered',()=>{
  for(const id of ['reference','enable-fp16','comparison','cancel','record','stop','analyze','copy'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/no nativo/);assert.match(html,/189 MB/);
});
test('no external ONNX script fetched before user analyzes',()=>{
  assert.match(html,/src="\.\/lab\.js\?v=human-controls-v4"/);
  assert.doesNotMatch(html,/transformers.*<script/i);
  assert.match(script,/analyze\.addEventListener\('click'/);
  assert.match(script,/prepareRecordedAudio\(audioBlob\)/);
  assert.match(script,/runVariant\(prepared,'q4','Q4 · ejecución 1'\)/);
  assert.match(script,/runVariant\(prepared,'q4','Q4 · repetición exacta'\)/);
});
