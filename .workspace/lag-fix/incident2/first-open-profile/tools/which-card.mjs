import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto('http://127.0.0.1:3080',{waitUntil:'domcontentloaded'});
await p.waitForSelector('button:has-text("设置")',{timeout:60000}); await sleep(4000);
const home=await p.evaluate(()=>[...document.querySelectorAll('[class*=_card]')].slice(0,20).map(e=>({cls:e.className.toString().slice(0,50),txt:(e.innerText||'').replace(/\n/g,'|').slice(0,120)})));
await p.locator('button:has-text("设置")').first().click(); await sleep(3000);
const dlg=await p.evaluate(()=>{
 const d=document.querySelector('div[role=dialog][aria-modal=true]');
 return {tabs:[...d.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,30),
  cards:[...d.querySelectorAll('[class*=_card]')].slice(0,20).map(e=>({cls:e.className.toString().slice(0,50),txt:(e.innerText||'').replace(/\n/g,'|').slice(0,100)})),
  svgCount:d.getElementsByTagName('svg').length, rectCount:d.getElementsByTagName('rect').length,
  text:(d.innerText||'').slice(0,700), nodes:document.getElementsByTagName('*').length};
});
console.log('HOME CARDS',JSON.stringify(home,null,1));
console.log('DIALOG',JSON.stringify(dlg,null,1));
await b.close();
