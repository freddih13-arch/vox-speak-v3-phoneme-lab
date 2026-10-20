import test from 'node:test';
import assert from 'node:assert/strict';
import { downmixChannels, resampleMono, encodePcm16Wav, analyzeSignal, AudioProcessingError } from '../src/phonetics/audio-processor.js';

const sine = (sampleRate, frequency, seconds=1, amplitude=.8) => Float32Array.from({length:Math.round(sampleRate*seconds)},(_,i)=>amplitude*Math.sin(2*Math.PI*frequency*i/sampleRate));
const rms=x=>Math.sqrt(x.reduce((acc,v)=>acc+v*v,0)/x.length);
function amplitudeAt(signal, sampleRate, f){let co=0,si=0;for(let i=0;i<signal.length;i++){const angle=2*Math.PI*f*i/sampleRate;co+=signal[i]*Math.cos(angle);si+=signal[i]*Math.sin(angle)}return 2*Math.hypot(co,si)/signal.length}

test('downmix safely averages stereo without changing original channels',()=>{
  const a=new Float32Array([.3,-.3,.9]);const b=new Float32Array([-.1,.1,-.1]);
  const c=downmixChannels([a,b]);assert.deepEqual([...c].map(x=>+x.toFixed(3)),[.1,-.1,.4]);
  assert.equal(a[0],Math.fround(.3));assert.notEqual(c,a);
});
test('downmix rejects mismatched channels and non-finite data',()=>{
  assert.throws(()=>downmixChannels([new Float32Array([1]),new Float32Array([1,2])]),{code:'invalid-channels'});
  assert.throws(()=>downmixChannels([new Float32Array([Number.NaN])]),{code:'invalid-audio'});
});
test('48k to 16k retains 1 kHz voice-band tone and exact duration',()=>{
  const y=resampleMono(sine(48000,1000),48000);assert.equal(y.length,16000);
  assert.ok(amplitudeAt(y,16000,1000)>.75);
  assert.ok(rms(y)>.50 && rms(y)<.60);
});
test('downsampling suppresses 10 kHz alias far above speech range',()=>{
  const y=resampleMono(sine(48000,10000),48000);
  assert.ok(rms(y)<.09,`alias RMS must be low, got ${rms(y)}`);
});
test('44.1 kHz to 16 kHz keeps 500 Hz vowel-band signal',()=>{
  const y=resampleMono(sine(44100,500,.25),44100);assert.equal(y.length,4000);
  assert.ok(amplitudeAt(y,16000,500)>.73);
});
test('16 kHz source returns a copied, unmodified signal',()=>{
  const x=sine(16000,440,.3);const y=resampleMono(x,16000);assert.equal(y.length,x.length);assert.notStrictEqual(x,y);assert.equal(y[10],x[10]);
});
test('duration limit and invalid frequencies give code-specific errors',()=>{
  assert.throws(()=>resampleMono(new Float32Array(16000*16),16000),{code:'too-long'});
  assert.throws(()=>resampleMono(new Float32Array(100),0),{code:'invalid-rate'});
});
test('signal stats identify silence, clipping and invalid NaN',()=>{
  assert.equal(analyzeSignal(new Float32Array(160)).probablySilent,true);
  const stats=analyzeSignal(new Float32Array([1,-1,.5]));assert.equal(stats.clippingRatio,2/3);
  assert.throws(()=>analyzeSignal(new Float32Array([NaN])),{code:'invalid-audio'});
});
test('WAV header is RIFF PCM16 mono 16 kHz with exactly correct payload',()=>{
  const wav=encodePcm16Wav(new Float32Array([0,.5,-.5,1,-1]));
  const v=new DataView(wav);const str=(start,n)=>Array.from({length:n},(_,i)=>String.fromCharCode(v.getUint8(start+i))).join('');
  assert.equal(str(0,4),'RIFF');assert.equal(str(8,4),'WAVE');assert.equal(str(36,4),'data');
  assert.equal(v.getUint16(20,true),1);assert.equal(v.getUint16(22,true),1);
  assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(34,true),16);
  assert.equal(v.getUint32(40,true),10);assert.equal(wav.byteLength,54);
  assert.equal(v.getInt16(44,true),0);assert.equal(v.getInt16(46,true),16384);
  assert.equal(v.getInt16(48,true),-16384);assert.equal(v.getInt16(50,true),32767);assert.equal(v.getInt16(52,true),-32768);
});
test('preparation rejects empty recording without opening browser audio context',async()=>{
  const {prepareRecordedAudio}=await import('../src/phonetics/audio-processor.js');
  await assert.rejects(prepareRecordedAudio(new Blob([])),{code:'empty-recording'});
});
