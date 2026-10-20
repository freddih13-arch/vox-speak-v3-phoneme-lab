"""Simulated UI check: no real mic, HTTP, or model inference; these are explicitly mocked."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,re
ROOT=Path(__file__).parents[1]
html=re.sub(r'<script\s+type="module"\s+src="\./lab\.js"></script>','', (ROOT/'index.html').read_text())
source='\n'.join((ROOT/x).read_text() for x in ['src/phonetics/audio-processor.js','src/phonetics/phonemes-local.js','lab.js'])
source=re.sub(r'^import .+?;\s*$', '',source,flags=re.M)
source=re.sub(r'^export\s+(?=const|let|function|class|async)', '',source,flags=re.M)
source='(function(){\n'+source+'\n})();'
mock=r'''
window.__labWorkerCreated=0;window.__labMsgs=[];
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
window.MediaRecorder=class {
 static isTypeSupported(){return true}
 constructor(){this.mimeType='audio/webm';this.state='inactive'}
 start(){this.state='recording'}
 requestData(){}
 stop(){this.state='inactive';setTimeout(()=>{this.ondataavailable?.({data:new Blob(['dummy-audio-data'],{type:'audio/webm'})});this.onstop?.()},0)}
};
window.AudioContext=class {
 async decodeAudioData(){const samples=new Float32Array(48000);for(let i=0;i<samples.length;i++)samples[i]=.12*Math.sin(2*Math.PI*440*i/48000);return {numberOfChannels:1,duration:1,sampleRate:48000,getChannelData:()=>samples}}
 async close(){}
};
window.Worker=class {
 constructor(){window.__labWorkerCreated++}
 postMessage(msg){window.__labMsgs.push({samples:msg.samples.length,sampleRate:msg.sampleRate});
  setTimeout(()=>this.onmessage?.({data:{requestId:msg.requestId,type:'status',stage:'loading-model'}}),1);
  setTimeout(()=>this.onmessage?.({data:{requestId:msg.requestId,type:'status',stage:'inferencing'}}),5);
  setTimeout(()=>this.onmessage?.({data:{requestId:msg.requestId,type:'result',modelId:'MOCK_TEST_ONLY',ipaRaw:'aɪ θɪŋk',inferenceMs:7,confidenceAvailable:false,phonemeScore:null}}),10);
 }
 terminate(){}
};
'''
checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':393,'height':852})
 errors=[];page.on('pageerror',lambda x:errors.append(str(x)))
 page.set_content(html)
 page.add_script_tag(content=mock)
 page.add_script_tag(content=source)
 assert page.locator('#analyze').is_disabled()
 assert page.evaluate('window.__labWorkerCreated')==0
 checks.append('UI begins idle without creating any worker or loading a model')
 page.locator('#record').click()
 page.wait_for_function('!document.getElementById("stop").disabled')
 page.locator('#stop').click()
 page.wait_for_function('!document.getElementById("analyze").disabled')
 assert page.locator('#playback').is_visible()
 checks.append('Simulated voice recording shows playable Blob controls')
 page.locator('#analyze').click()
 page.wait_for_function('document.getElementById("ipa").textContent.includes("θ")')
 assert page.evaluate('window.__labWorkerCreated')==1
 assert page.evaluate('window.__labMsgs[0].sampleRate')==16000
 assert page.locator('#state').inner_text().startswith('✅')
 checks.append('Float32 mono 16 kHz forwarded on first analyze; mock IPA displayed, no fake score')
 assert page.locator('#copy').is_enabled()
 assert not errors,errors
 checks.append('Copy-results button enabled and no runtime JS exceptions')
 browser.close()
print(json.dumps({'passed':len(checks),'checks':checks,'warning':'All browser mic, AudioContext and Worker interactions mocked'},ensure_ascii=False,indent=2))
