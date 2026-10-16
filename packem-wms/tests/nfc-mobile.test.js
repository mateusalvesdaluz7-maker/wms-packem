const test=require('node:test'),assert=require('node:assert/strict');
const {createClient,CountQueue}=require('../wms-nfc-mobile.js');
const {applyItemReading}=require('../wms-nfc-reader.js');
const {service,normalizeUid}=require('../server/nfc-mobile-core.js');
const mobile=require('../api/nfc-mobile.js')._test.makeHandler,webhook=require('../api/nfc-webhook.js')._test.makeHandler;
const rid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const config={readerId:rid,sessionId:sid,target:'v-inv',contextKey:'qa/task1/pass1'};
const uid='04112233445566',second='04778899001122',key='a'.repeat(43);
function apiFixture(){
  const calls=[];let role='admin',active=true,readerActive=true,mode='count';
  const options={env:()=>({SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key-only',NODE_ENV:'production'}),fetcher:async(url,opts)=>{
    calls.push({url,body:opts.body&&JSON.parse(opts.body)});
    if(url.includes('/usuarios?'))return {ok:true,json:async()=>active?[{u:'qa',p:'test-password-only',active:true,role}]:[]};
    if(url.includes('/wms_nfc_readers?'))return {ok:true,json:async()=>readerActive?[{id:rid,owner:'qa',mode,target:'v-inv',active:true,expires_at:'2030-01-01T00:00:00Z'}]:[]};
    return {ok:true,json:async()=>({id:rid})};
  }};
  return {calls,options,token:()=>service(options).issue({u:'qa'}),setRole:v=>role=v,deactivate:()=>active=false,revoke:()=>readerActive=false,setMode:v=>mode=v};
}
async function run(handler,body,headers={},query={}){
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;},end(){return this;}};
  await handler({method:'POST',headers,body,query,socket:{remoteAddress:'qa-tests'}},res);return res;
}
test('UID do chip aceita separadores; UUID de QR e texto NDEF não são UID',()=>{
  assert.equal(normalizeUid('04:11:22:33:44:55:66'),uid);
  for(const value of ['A420F544-CDA6-442F-803F-56C47784150F','JOB=wms;ID=T001','1234',null])assert.throws(()=>normalizeUid(value));
});
test('login troca senha por token curto e a API não expõe a chave do serviço',async()=>{
  const f=apiFixture(),res=await run(mobile(f.options),{action:'login',auth:{u:'qa',p:'test-password-only'}});
  assert.equal(res.code,200);assert.ok(res.body.token);assert.ok(!JSON.stringify(res.body).includes('test-service-key-only'));
  assert.equal((await run(mobile(f.options),{action:'reader_list'},{authorization:'Bearer '+res.body.token})).code,200);
  assert.equal((await run(mobile(f.options),{action:'login',auth:{u:'qa',p:'wrong'}})).code,401);
});
test('token adulterado, token vencido e usuário desativado são recusados',async()=>{
  const f=apiFixture(),handler=mobile(f.options),token=f.token();
  for(const value of [token+'x',token.split('.')[0]+'.'+'é'.repeat(43),service({...f.options,now:()=>Date.now()-16*60000}).issue({u:'qa'})])assert.equal((await run(handler,{action:'reader_list'},{authorization:'Bearer '+value})).code,401);
  f.deactivate();assert.equal((await run(handler,{action:'reader_list'},{authorization:'Bearer '+token})).code,401);
});
test('permissões são reconsultadas e cursor inválido não chega ao banco',async()=>{
  const f=apiFixture(),token=f.token();f.setRole('consulta');
  assert.equal((await run(mobile(f.options),{action:'enroll_arm',data:{readerId:rid,operationId:sid,item:'T001'}},{authorization:'Bearer '+token})).code,403);
  assert.equal((await run(mobile(f.options),{action:'count_status',data:{readerId:rid,sessionId:sid,cursor:1001}},{authorization:'Bearer '+token})).code,400);
  assert.ok(!f.calls.some(c=>c.url.includes('/rpc/')));
});
test('Webhook usa chave privada, ignora produto/peso do corpo e entrega só UID ao banco',async()=>{
  const f=apiFixture(),res=await run(webhook(f.options),{identifier:'04:11:22:33:44:55:66',date:new Date().toISOString(),content:'ID=WRONG;QTD=999999',item:'WRONG'},{},{key});
  assert.equal(res.code,204);const rpc=f.calls.find(c=>c.url.includes('/rpc/')).body;
  assert.equal(rpc.p_payload.uid,uid);assert.equal(rpc.p_payload.content,undefined);assert.equal(rpc.p_payload.item,undefined);
  assert.ok(!JSON.stringify(rpc).includes(key));
});
test('probe oficial não vira tag; QR é recusado antes de entrar na fila',async()=>{
  const f=apiFixture(),handler=webhook(f.options);
  assert.equal((await run(handler,{identifier:'xx:xx:xx:xx',content:'Awesome it worked!'},{},{key})).code,204);
  assert.equal(f.calls.find(c=>c.url.includes('/rpc/')).body.p_payload.probe,true);
  const n=f.calls.filter(c=>c.url.includes('/rpc/')).length;
  assert.equal((await run(handler,{identifier:'A420F544-CDA6-442F-803F-56C47784150F',date:new Date().toISOString(),content:'T001'},{},{key})).code,422);
  assert.equal(f.calls.filter(c=>c.url.includes('/rpc/')).length,n);
});
test('Webhook recusa leitor revogado, data ausente, origem externa e configuração incompleta',async()=>{
  const f=apiFixture(),body={identifier:uid,content:''};
  assert.equal((await run(webhook(f.options),body,{},{key})).code,400);
  assert.equal((await run(webhook(f.options),body,{origin:'https://untrusted.invalid'},{key})).code,403);
  f.revoke();assert.equal((await run(webhook(f.options),body,{},{key})).code,401);
  assert.equal((await run(webhook({...f.options,env:()=>({})}),body,{},{key})).code,503);
});
test('falhas do banco são redigidas e migração ausente vira orientação de ativação',async()=>{
  for(const [code,status] of [['42P01',503],['PGRST202',503],['XX000',502]]){
    const f=apiFixture();f.options.fetcher=async()=>({ok:false,json:async()=>({code,message:'private detail test-service-key-only'})});
    const result=await run(mobile(f.options),{action:'login',auth:{u:'qa',p:'test'}});
    assert.equal(result.code,status);assert.ok(!JSON.stringify(result.body).includes('private detail'));
  }
});
function queueFixture(){
  let active=true,cursor=0,reads=[{seq:1,uid},{seq:2,uid:second}],failAck=false;
  const counted=new Set(),catalog={T001:{codigo:'0303450047',quantidade:300,unidade:'KG'},T002:{codigo:'0303450047',quantidade:250.5,unidade:'KG'}},registry=new Map([[uid,'T001'],[second,'T002']]),calls=[],notices=[];
  const state=()=>({session:{id:sid,target:config.target,contextKey:config.contextKey,active:true,cursor,received:reads.length,expiresAt:new Date(Date.now()+3600000).toISOString()},items:reads.filter(x=>x.seq>cursor)});
  const context={isActive:()=>active,lookup:async id=>catalog[id],has:id=>counted.has(id),add:async id=>counted.add(id)};
  const options={api:async(action,data)=>{calls.push({action,data});if(action==='count_ack'){if(failAck){failAck=false;throw Error('offline');}cursor=data.cursor;}return state();},
    resolve:async key=>{const id=registry.get(key);if(!id)throw Error('Tag não cadastrada');const p=catalog[id];return {item:id,codigo:p.codigo,quantidade:String(p.quantidade),unidade:p.unidade};},apply:applyItemReading,notify:text=>notices.push(text)};
  const queue=new CountQueue(options);
  return {queue,options,context,counted,catalog,registry,calls,notices,state,deactivate:()=>active=false,activate:()=>active=true,failAck:()=>failAck=true,setReads:r=>reads=r};
}
test('fila conta duas embalagens com peso correto usando o fluxo do WMS',async()=>{
  const f=queueFixture();await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,2);assert.equal([...f.counted].reduce((sum,id)=>sum+f.catalog[id].quantidade,0),550.5);
  await f.queue.poll();assert.equal(f.counted.size,2);assert.equal(f.state().session.cursor,2);
});
test('tag desconhecida bloqueia a sequência e fica pendente para correção',async()=>{
  const f=queueFixture();f.registry.delete(uid);await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,0);assert.equal(f.state().session.cursor,0);assert.equal(f.queue.blocked,true);
  f.registry.set(uid,'T001');f.queue.blocked=false;await f.queue.poll();assert.equal(f.counted.size,2);
});
test('resposta de confirmação perdida não soma embalagem novamente',async()=>{
  const f=queueFixture();f.failAck();await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,1);assert.equal(f.state().session.cursor,0);
  f.queue.blocked=false;await f.queue.poll();assert.equal(f.counted.size,2);assert.equal(f.state().session.cursor,2);
});
test('tela oculta/tarefa trocada não aplica; voltar ao contexto processa a fila',async()=>{
  const f=queueFixture();await f.queue.start(config,f.context);f.deactivate();await f.queue.poll();assert.equal(f.counted.size,0);
  f.activate();await f.queue.poll();assert.equal(f.counted.size,2);
});
test('troca de usuário ou pausa durante consulta impede aplicação atrasada',async()=>{
  for(const pause of [false,true]){
    const f=queueFixture();let release;f.options.resolve=()=>new Promise(resolve=>release=resolve);
    await f.queue.start(config,f.context);const pending=f.queue.poll();await new Promise(r=>setImmediate(r));
    if(pause)await f.queue.pause();else f.deactivate();
    release({item:'T001',codigo:'0303450047',quantidade:'300',unidade:'KG'});await pending;assert.equal(f.counted.size,0);
  }
});
test('fila de outro contexto, lacuna ou entrada sem confirmação não é confirmada',async()=>{
  for(const kind of ['context','gap','add']){
    const f=queueFixture();if(kind==='add')f.context.add=async()=>{};
    await f.queue.start(config,f.context);
    if(kind==='context'){const old=f.options.api;f.options.api=async(a,d)=>({...await old(a,d),session:{...f.state().session,contextKey:'task2'}});}
    if(kind==='gap')f.setReads([{seq:2,uid}]);
    await f.queue.poll();assert.equal(f.state().session.cursor,0);assert.equal(f.queue.blocked,true);
  }
});
test('cliente não persiste senha, usa Bearer e limpa sessão quando usuário muda',async()=>{
  let auth={u:'qa',p:'test-password'},calls=[];
  const client=createClient({auth:()=>auth,fetch:async(url,options)=>{calls.push(options);return {ok:true,status:200,json:async()=>JSON.parse(options.body).action==='login'?{token:'test-token'}:{ok:true,data:[]}};}});
  await client.request('reader_list');await client.request('reader_list');
  assert.equal(calls.length,3);assert.equal(calls[1].headers.authorization,'Bearer test-token');assert.ok(!calls[1].body.includes('test-password'));
  auth=null;await assert.rejects(client.request('reader_list'),/Entre novamente/);
});
