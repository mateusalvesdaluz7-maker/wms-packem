const test=require('node:test'),assert=require('node:assert/strict');
const {createManager}=require('../wms-nfc-inventory-lifecycle.js');
const {parse,makeHandler}=require('../api/nfc-inventory.js')._test;
const {service}=require('../server/nfc-mobile-core.js');
const {createClient}=require('../wms-nfc-mobile.js');
const rid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',consumer='33333333-3333-4333-8333-333333333333';
const row={seq:1,uid:'53000000000001',item:'R001',codigo:'0303450157',quantidade:'334.22',unidade:'KG',confirmed:true};
function fixture(){
 let user='qa',active=true,current={id:sid},history=[],capture={readerId:rid,sessionId:sid,consumerId:consumer,viewTarget:'v-nfc-test'},rows=[row],fail=false;
 const calls=[],finished={id:sid,finishedAt:'2026-10-19T12:00:00Z',entries:[row],items:1};
 const options={user:()=>user,active:()=>active,reader:async()=>rid,capture:()=>capture,entries:()=>rows,prepare:async()=>{},completed:id=>calls.push(['completed',id]),
   start:async fresh=>{calls.push(['start',fresh]);if(fresh){current={id:'44444444-4444-4444-8444-444444444444'};rows=[];}capture={readerId:rid,consumerId:consumer,viewTarget:'v-nfc-test',...capture,sessionId:current.id};return capture;},
   api:async(action,data)=>{calls.push([action,data]);if(action==='inventory_list')return {current,history,hasMore:false};if(action==='inventory_finish'){current=null;history=[finished];if(fail)throw Error('Resposta perdida');return finished;}if(action==='inventory_get')return finished;}};
 return {manager:createManager(options),options,calls,finished,setUser:v=>user=v,setActive:v=>active=v,setCapture:v=>capture=v,loseReply:()=>fail=true,entries:()=>rows};
}
test('encerrar salva o resultado; iniciar outro usa nova captura vazia e conserva o histórico',async()=>{
 const f=fixture();await f.manager.load();await assert.rejects(f.manager.begin(true),/Encerre/);assert.equal(f.calls.filter(x=>x[0]==='start').length,0);
 await f.manager.finish();assert.equal(f.manager.state.current,null);assert.equal(f.manager.state.detail.entries[0].quantidade,'334.22');
 await f.manager.begin(true);assert.deepEqual(f.entries(),[]);assert.equal(f.manager.state.history.length,1);await f.manager.select(sid);assert.equal(f.manager.state.detail.id,sid);
});
test('leituras sem confirmação impedem encerramento e não limpam o resultado atual',async()=>{
 const f=fixture();f.options.entries=()=>[{...row,confirmed:false}];await assert.rejects(f.manager.finish(),/confirmação/);assert.ok(!f.calls.some(c=>c[0]==='inventory_finish'));assert.equal(f.entries().length,1);
});
test('resposta de encerramento perdida é recuperada pelo mesmo ID sem criar inventário ou duplicar histórico',async()=>{
 const f=fixture();f.loseReply();await assert.rejects(f.manager.finish(),/perdida/);await f.manager.finish();assert.equal(f.manager.state.detail.id,sid);assert.equal(f.calls.filter(c=>c[0]==='inventory_finish').length,1);assert.ok(!f.calls.some(c=>c[0]==='start'));
});
test('novo inventário reconhece o encerramento confirmado no servidor após resposta perdida',async()=>{
 const f=fixture();f.loseReply();await assert.rejects(f.manager.finish(),/perdida/);await f.manager.begin(true);assert.ok(f.calls.some(c=>c[0]==='completed'&&c[1]===sid));assert.deepEqual(f.entries(),[]);assert.equal(f.manager.state.history.length,1);
});
test('troca de usuário ou tela descarta respostas e impede encerramento de outro contexto',async()=>{
 for(const change of ['user','view']){const f=fixture();f.options.prepare=async()=>{if(change==='user')f.setUser('other');else f.setActive(false);};await assert.rejects(f.manager.finish());assert.ok(!f.calls.some(c=>c[0]==='inventory_finish'));}
 const f=fixture();let resolve;f.options.api=()=>new Promise(r=>resolve=r);const pending=f.manager.load();await new Promise(r=>setImmediate(r));f.setUser('other');resolve({current:null,history:[],hasMore:false});await assert.rejects(pending);assert.equal(f.manager.state.loaded,false);
});
test('clique repetido não dispara dois encerramentos',async()=>{
 const f=fixture();let resolve;f.options.prepare=()=>new Promise(r=>resolve=r);const pending=f.manager.finish();await new Promise(r=>setImmediate(r));await assert.rejects(f.manager.finish(),/Aguarde/);resolve();await pending;assert.equal(f.calls.filter(c=>c[0]==='inventory_finish').length,1);
});

test('encerrar após reabrir recupera a mesma sessão e conserva todas as leituras',async()=>{
 const f=fixture();f.setCapture(null);await f.manager.finish();
 assert.deepEqual(f.calls.filter(c=>c[0]==='start'),[['start',false]]);
 assert.equal(f.manager.state.detail.id,sid);assert.deepEqual(f.manager.state.detail.entries,[row]);
 assert.equal(f.calls.find(c=>c[0]==='inventory_finish')[1].sessionId,sid);
});

test('falha ou troca de tela durante recuperação não encerra nem inicia outra captura',async()=>{
 for(const mode of ['failure','changed','wrong']){
  const f=fixture();f.setCapture(null);f.options.start=async()=>{if(mode==='failure')throw Error('Conexão interrompida');if(mode==='changed')f.setActive(false);return {};};
  await assert.rejects(f.manager.finish());assert.ok(!f.calls.some(c=>c[0]==='inventory_finish'));assert.equal(f.entries().length,1);
 }
});
test('API valida tamanho, itens duplicados, UID, código, quantidade e unidade antes de chamar o banco',()=>{
 const request={body:{action:'inventory_finish',data:{readerId:rid,sessionId:sid,consumerId:consumer,entries:[row]}},headers:{}};assert.equal(parse(request).data.entries[0].confirmed,undefined);
 for(const entry of [{...row,quantidade:'-1'},{...row,unidade:'??'},{...row,uid:'QR-UUID'},{...row,codigo:'x;DROP'},{...row,seq:1001}])assert.throws(()=>parse({...request,body:{...request.body,data:{...request.body.data,entries:[entry]}}}));
 assert.throws(()=>parse({...request,body:{...request.body,data:{...request.body.data,entries:[row,row]}}}));assert.throws(()=>parse({...request,headers:{'content-length':600000}}));
});
test('API usa token do usuário e RPC exclusivo; fila pendente retorna erro sem expor detalhes privados',async()=>{
 let result={reason:'pending'};const calls=[],options={env:()=>({SUPABASE_URL:'https://qa.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-key',NODE_ENV:'production'}),fetcher:async(url,init)=>{calls.push({url,body:init.body&&JSON.parse(init.body)});return {ok:true,json:async()=>url.includes('usuarios?')?[{u:'qa',role:'admin',active:true}]:result};}};
 const handler=makeHandler(options),token=service(options).issue({u:'qa'}),req={method:'POST',headers:{authorization:'Bearer '+token},body:{action:'inventory_finish',data:{readerId:rid,sessionId:sid,consumerId:consumer,entries:[row]}},socket:{remoteAddress:'inventory-test'}};
 function response(){return {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
 let res=response();await handler(req,res);assert.equal(res.code,409);assert.match(res.body.error,/leituras pendentes/);assert.ok(calls.some(c=>c.url.endsWith('/rpc/wms_nfc_inventory')&&c.body.p_actor==='qa'));
 result={id:sid,finishedAt:'2026-10-19',entries:[row]};res=response();await handler(req,res);assert.equal(res.code,200);assert.ok(!JSON.stringify(res.body).includes('test-only-key'));
 res=response();await handler({...req,headers:{}},res);assert.equal(res.code,401);
});
test('cliente compartilha autenticação e encaminha somente ações de inventário ao endpoint de inventário',async()=>{
 const calls=[],client=createClient({auth:()=>({u:'qa',p:'test'}),fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push([url,body.action]);return {ok:true,status:200,json:async()=>body.action==='login'?{token:'test-token'}:{ok:true,data:{history:[]}}};}});
 await client.request('inventory_list',{readerId:rid,offset:0});assert.deepEqual(calls,[['/api/nfc-mobile','login'],['/api/nfc-inventory','inventory_list']]);
});
