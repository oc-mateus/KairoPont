// Bounded anonymous/forged-token checks. No valid user session, signup, emails,
// file uploads or requests targeting real row IDs are used by this runner.
import { readFile, writeFile } from 'node:fs/promises';

const envText = await readFile('.env', 'utf8').catch(() => '');
function config(name) {
  const value = process.env[name] || envText.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim();
  return value?.replace(/^['"]|['"]$/g, '');
}
const origin = config('VITE_SUPABASE_URL');
const key = config('VITE_SUPABASE_ANON_KEY');
if (!origin || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin)) throw new Error('Configure the project URL and public anon key.');
const nil = '00000000-0000-0000-0000-000000000000';
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: nil, role: 'service_role', exp: Math.floor(Date.now()/1000)+3600 })}.`;
const results = [];
async function probe(name, path, { method = 'GET', body, token = key, headers = {}, accept = [401,403] } = {}) {
  const response = await fetch(origin + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Never retain row contents, credentials, headers or provider error details.
  await response.arrayBuffer();
  const passed = accept.includes(response.status);
  results.push({ name, status: response.status, passed });
  if (!passed) console.error(`Unexpected response: ${name} (${response.status})`);
}
for (const table of ['funcionarios','registros_ponto','documentos','auditoria','feriados','periodos_aquisitivos_ferias','solicitacoes_ferias','notificacoes','funcionario_convites','support_tickets']) {
  await probe(`anonymous table read: ${table}`, `/rest/v1/${table}?select=*&limit=1`);
}
for (const token of [null, forged, 'invalid.jwt.signature']) {
  await probe(`employee data with ${token === null ? 'no token' : token === forged ? 'forged role' : 'invalid signature'}`, '/rest/v1/funcionarios?select=id&limit=1', { token });
}
await probe('anonymous role escalation', `/rest/v1/funcionarios?id=eq.${nil}`, { method:'PATCH', body:{role:'admin',ativo:true,suporte:true} });
await probe('anonymous location alteration', `/rest/v1/registros_ponto?id=eq.${nil}`, { method:'PATCH', body:{entrada_localizacao:{status:'captured',latitude:0,longitude:0,accuracy:0}} });
await probe('anonymous record deletion', `/rest/v1/registros_ponto?id=eq.${nil}`, { method:'DELETE' });
const rpcs = [
  ['is_admin',{}],['is_support',{}],['sync_current_vacation_periods',{}],
  ['registrar_ponto',{p_funcionario_id:nil,p_tipo:'entrada'}],
  ['registrar_ponto',{p_funcionario_id:nil,p_tipo:'entrada',p_localizacao:{status:'denied'}}],
  ['admin_update_employee',{p_funcionario_id:nil,p_ativo:true,p_role:'admin'}],
  ['admin_delete_punch_record',{p_record_id:nil}],
  ['admin_update_employee_details',{p_funcionario_id:nil,p_nome:'test',p_cargo:'test',p_data_admissao:null,p_escala_trabalho:null,p_tipo_contrato:'pj',p_suporte:true}],
  ['list_support_tickets',{p_status:'todos',p_offset:0}],
  ['support_update_ticket_status',{p_ticket_id:nil,p_status:'respondido'}],
  ['consume_edge_rate_limit',{p_action:'invite-employee',p_actor_id:nil}],
  ['consume_support_quota',{p_action:'support-question',p_actor_id:nil}],
  ['claim_support_email',{p_ticket_id:nil}],
];
for (const [name,body] of rpcs) await probe(`anonymous RPC: ${name} (${Object.keys(body).length} args)`, '/rest/v1/rpc/'+name, {method:'POST',body});
for (const name of ['invite-employee','vacation-decision-email','support-assistant']) {
  await probe(`${name}: no session`, '/functions/v1/'+name, {method:'POST',token:null,body:{}});
  await probe(`${name}: public key is not a user`, '/functions/v1/'+name, {method:'POST',body:{}});
  await probe(`${name}: forged administrator`, '/functions/v1/'+name, {method:'POST',token:forged,body:{}});
  await probe(`${name}: hostile origin`, '/functions/v1/'+name, {method:'OPTIONS',headers:{Origin:'https://attacker.invalid'},accept:[403]});
  await probe(`${name}: application origin`, '/functions/v1/'+name, {method:'OPTIONS',headers:{Origin:'https://oc-mateus.github.io'},accept:[200,204]});
}
await probe('anonymous private bucket listing','/storage/v1/object/list/documentos',{method:'POST',body:{prefix:'',limit:1},accept:[200,400,401,403]});
// Listing can legitimately return HTTP 200 with [] under Storage RLS. Check
// emptiness explicitly, rather than treating that status alone as proof.
const listing = await fetch(origin+'/storage/v1/object/list/documentos',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{"prefix":"","limit":1}',signal:AbortSignal.timeout(15000)});
const data = await listing.json();
results.push({name:'private bucket discloses no object names',status:listing.status,passed:!listing.ok || (Array.isArray(data)&&data.length===0)});
const summary = { date:new Date().toISOString(), project:new URL(origin).hostname, tests:results.length, passed:results.filter(r=>r.passed).length, failed:results.filter(r=>!r.passed).length, results };
if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.failed) process.exitCode=1;
