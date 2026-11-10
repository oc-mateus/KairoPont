// Small, fixed production probes, never a distributed denial-of-service test.
// Stops the burst on rate limiting, a server error or excessive latency.
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
const env = await readFile('.env','utf8');
const get = (name) => (process.env[name] || env.match(new RegExp(`^${name}\\s*=\\s*(.+)$`,'m'))?.[1]?.trim())?.replace(/^['"]|['"]$/g,'');
const origin=get('VITE_SUPABASE_URL'),key=get('VITE_SUPABASE_ANON_KEY');
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin||'')||!key)throw Error('Configure this project URL and public key.');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
const attempts=[];
const email=`security-${randomUUID()}@example.invalid`;
// These target a nonexistent account. They cannot lock out a real employee.
for(const password of ["' OR '1'='1",'admin','password','123456',"';SELECT pg_sleep(1);--",'incorrect-01','incorrect-02','incorrect-03','incorrect-04','incorrect-05']) {
  const start=performance.now();
  const r=await fetch(origin+'/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email,password}),signal:AbortSignal.timeout(10000)});
  const body=await r.json();
  const passed=[400,401,422,429].includes(r.status)&&!body.access_token&&!body.user;
  attempts.push({status:r.status,passed,ms:Math.round(performance.now()-start)});
  if(!passed||r.status===429||r.status>=500)break;
  await new Promise(resolve=>setTimeout(resolve,300));
}
const burst=[];
let stop=false,next=0;
async function worker(){
  while(!stop){
    const index=next++;if(index>=24)return;
    const start=performance.now();
    try{
      const r=await fetch(origin+'/rest/v1/funcionarios?select=id&limit=1',{headers,signal:AbortSignal.timeout(10000)});
      await r.arrayBuffer();
      const ms=Math.round(performance.now()-start);
      burst.push({status:r.status,ms,passed:[401,403,429].includes(r.status)});
      if(r.status===429||r.status>=500||ms>5000)stop=true;
    }catch{burst.push({status:0,passed:false});stop=true;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}
await Promise.all([worker(),worker(),worker()]);
const times=burst.map(x=>x.ms).filter(Number.isFinite).sort((a,b)=>a-b);
const report={date:new Date().toISOString(),login:{attempts:attempts.length,passed:attempts.every(x=>x.passed),statuses:attempts.map(x=>x.status)},boundedLoad:{requests:burst.length,concurrency:3,stoppedEarly:stop,passed:burst.every(x=>x.passed),p95ms:times[Math.ceil(times.length*.95)-1],statuses:burst.reduce((map,x)=>({...map,[x.status]:(map[x.status]||0)+1}),{})},limits:'One source IP, maximum 24 data requests and 10 invalid logins; not a real DDoS or capacity guarantee.'};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.login.passed||!report.boundedLoad.passed)process.exitCode=1;
