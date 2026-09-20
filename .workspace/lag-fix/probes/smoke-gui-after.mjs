import { chromium } from 'playwright';
const URL='http://127.0.0.1:3080';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
const errs=[],logs=[];
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,300)); });
p.on('pageerror',e=>errs.push('PAGEERROR '+String(e).slice(0,300)));
p.on('requestfailed',r=>logs.push('REQFAIL '+r.url().slice(0,120)+' '+String(r.failure()?.errorText).slice(0,80)));
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(10000);
const state=await p.evaluate(()=>({
  nodes: document.getElementsByTagName('*').length,
  title: document.title,
  bodyText: (document.body?.innerText||'').slice(0,300),
  hasSidebar: !!document.querySelector('[class*="sidebar" i],[data-dsh-sidebar],aside'),
  scripts: [...document.querySelectorAll('script[src]')].map(s=>s.src.split('/').slice(-1)[0]).slice(0,8),
}));
console.log(JSON.stringify({state,errors:errs.slice(0,12),failed:logs.slice(0,8)},null,1));
await p.screenshot({path:'/home/CNS2026495165/dsh/.workspace/lag-fix/reports/smoke-after-patch.png'});
await b.close();
