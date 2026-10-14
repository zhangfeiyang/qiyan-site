import {chromium} from 'playwright';
import {spawn} from 'child_process';
const [,, startS, endS, out, scaleS='1'] = process.argv;
const FPS=30, start=+startS, end=+endS;
const FF='./node_modules/ffmpeg-static/ffmpeg';
const ff=spawn(FF,['-loglevel','error','-y','-f','image2pipe','-c:v','mjpeg','-framerate',String(FPS),'-i','-','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-r',String(FPS),out],{stdio:['pipe','inherit','inherit']});
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1080,height:1920}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto(`http://localhost:8765/index.html?scale=${scaleS}`);
await p.waitForFunction(()=>window.ready,{timeout:180000});
const t0=Date.now();
for(let f=start; f<end; f++){
  await p.evaluate(t=>window.renderAt(t), f/FPS);
  const buf=await p.screenshot({type:'jpeg',quality:94});
  if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
  if((f-start)%60===0) console.log(out, 'frame', f, 'avg ms', ((Date.now()-t0)/(f-start+1)).toFixed(0));
}
ff.stdin.end();
await new Promise(r=>ff.on('close',r));
await b.close();
console.log(out,'done',((Date.now()-t0)/1000).toFixed(0),'s');
