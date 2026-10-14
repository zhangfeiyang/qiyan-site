import {chromium} from 'playwright';
import fs from 'fs';
const [,, outDir, scale, ...times] = process.argv;
fs.mkdirSync(outDir,{recursive:true});
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:1080,height:1920}});
p.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') console.log('console:',m.text()); });
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto(`http://localhost:8765/index.html?scale=${scale}`);
await p.waitForFunction(()=>window.ready,{timeout:120000});
let i=0;
for(const t of times){ const t0=Date.now(); await p.evaluate(t=>window.renderAt(t),+t); await p.screenshot({path:`${outDir}/f${String(i).padStart(2,'0')}_${t}.jpg`,type:'jpeg',quality:85}); console.log('t',t,'ms',Date.now()-t0); i++; }
if(process.env.EVENTS){ fs.writeFileSync(process.env.EVENTS, JSON.stringify(await p.evaluate(()=>window.getEvents()))); }
await b.close();
