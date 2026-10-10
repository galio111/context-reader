import {randomUUID} from 'node:crypto';
// Direct provider requests: no application route, Storage, conversion or player.
const cases = [
  {id:'repeat-plain',textType:'plain',text:'faction'},
  {id:'capitalized',textType:'plain',text:'Faction'},
  {id:'repeat-spelled',textType:'ssml',text:'<speak><phoneme alphabet="cmu" ph="F AE1 K SH AH0 N">faction</phoneme></speak>'},
  {id:'repeat-neutral',textType:'ssml',text:'<speak><phoneme alphabet="cmu" ph="F AE1 K SH AH0 N">word</phoneme></speak>'},
  {id:'fraction-control',textType:'plain',text:'fraction'},
];
for (const item of cases) {
  const audio={voice_type:'en_female_amanda_mars_bigtts',encoding:'mp3',speed_ratio:0.9,explicit_language:'en'};
  const response=await fetch('https://openspeech.bytedance.com/api/v1/tts',{
    method:'POST',headers:{Authorization:`Bearer;${process.env.VOLCENGINE_TTS_ACCESS_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({app:{appid:process.env.VOLCENGINE_TTS_APP_ID,token:process.env.VOLCENGINE_TTS_ACCESS_TOKEN,cluster:'volcano_tts'},user:{uid:'context-reader-faction-diagnosis-1010'},audio,request:{reqid:randomUUID(),text:item.text,text_type:item.textType,operation:'query'}}),
    signal:AbortSignal.timeout(20000)
  });
  const payload=await response.json();
  console.log(JSON.stringify({...item,parameters:audio,status:response.status,code:payload.code,audio:payload.data||null}));
}
