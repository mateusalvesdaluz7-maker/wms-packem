const test=require('node:test'),assert=require('node:assert/strict');
const {createClient,CountQueue,createTestCount}=require('../wms-nfc-mobile.js');
const {applyItemReading}=require('../wms-nfc-reader.js');
const {service,normalizeUid}=require('../server/nfc-mobile-core.js');
const mobile=require('../api/nfc-mobile.js')._test.makeHandler,webhook=require('../api/nfc-webhook.js')._test.makeHandler;
const rid='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const config={readerId:rid,sessionId:sid,consumerId:'33333333-3333-4333-8333-333333333333',target:'v-inv',contextKey:'qa/task1/pass1'};
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
  assert.equal(normalizeUid('53 0a c2 ba 33 00 01'),'530AC2BA330001');
  for(const value of ['A420F544-CDA6-442F-803F-56C47784150F','JOB=wms;ID=T001','1234',null,'00000000000000','FFFFFFFFFFFFFF','540AC2BA330001','530AC2BA3300','530AC2BA33000100'])assert.throws(()=>normalizeUid(value));
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
test('Webhook recebe UID Feiju de uma tag vazia, sem exigir conteúdo NDEF',async()=>{
  const f=apiFixture(),res=await run(webhook(f.options),{identifier:'53 0A C2 BA 33 00 01',date:new Date().toISOString(),content:''},{},{key});
  assert.equal(res.code,204);const rpc=f.calls.find(c=>c.url.includes('/rpc/')).body;
  assert.equal(rpc.p_payload.uid,'530AC2BA330001');assert.equal(rpc.p_payload.content,undefined);assert.equal(rpc.p_payload.item,undefined);
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
  let active=true,cursor=0,reads=[{seq:1,uid},{seq:2,uid:second}],failAck=false,queueSession={...config};
  const counted=new Set(),catalog={T001:{codigo:'0303450047',quantidade:300,unidade:'KG'},T002:{codigo:'0303450047',quantidade:250.5,unidade:'KG'}},registry=new Map([[uid,'T001'],[second,'T002']]),calls=[],notices=[];
  const state=(from=cursor)=>({session:{id:queueSession.sessionId,consumerId:queueSession.consumerId,target:queueSession.target,contextKey:queueSession.contextKey,active:true,cursor,received:reads.length,expiresAt:new Date(Date.now()+3600000).toISOString()},items:reads.filter(x=>x.seq>from).slice(0,100)});
  const context={isActive:()=>active,lookup:async id=>catalog[id],has:id=>counted.has(id),add:async id=>counted.add(id)};
  const options={api:async(action,data)=>{calls.push({action,data});if(action==='count_start'){if(data.sessionId!==queueSession.sessionId){cursor=0;reads=[];}queueSession={...data};}if(action==='count_ack'){if(failAck){failAck=false;throw Error('offline');}cursor=data.cursor;}return state(data.cursor);},
    resolve:async key=>{const id=registry.get(key);if(!id)throw Error('Tag não cadastrada');const p=catalog[id];return {item:id,codigo:p.codigo,quantidade:String(p.quantidade),unidade:p.unidade};},apply:applyItemReading,notify:text=>notices.push(text)};
  const queue=new CountQueue(options);
  return {queue,options,context,counted,catalog,registry,calls,notices,state,deactivate:()=>active=false,activate:()=>active=true,failAck:()=>failAck=true,setReads:r=>reads=r};
}
test('fila conta duas embalagens com peso correto usando o fluxo do WMS',async()=>{
  const f=queueFixture();await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,2);assert.equal([...f.counted].reduce((sum,id)=>sum+f.catalog[id].quantidade,0),550.5);
  await f.queue.poll();assert.equal(f.counted.size,2);assert.equal(f.state().session.cursor,2);
});
test('fila aceita UID Feiju, mantém metros do WMS e não duplica a mesma embalagem',async()=>{
  const f=queueFixture(),feiju='530AC2BA330001';
  f.registry.set(feiju,'T001');f.catalog.T001={codigo:'0303410008',quantidade:5000,unidade:'MT'};
  f.setReads([{seq:1,uid:feiju}]);await f.queue.start(config,f.context);await f.queue.poll();
  assert.deepEqual([...f.counted],['T001']);assert.equal(f.catalog.T001.unidade,'MT');assert.equal(f.state().session.cursor,1);
  f.setReads([{seq:1,uid:feiju},{seq:2,uid:feiju}]);await f.queue.poll();
  assert.equal(f.counted.size,1);assert.equal(f.state().session.cursor,2);
});
test('teste físico usa a fila real sem aplicar entradas; releitura e confirmação perdida não duplicam',async()=>{
  const f=queueFixture();f.catalog.T001={codigo:'0303410008',quantidade:5000,unidade:'MT'};
  const trial=createTestCount({scope:config.contextKey,isActive:()=>true,lookup:f.context.lookup});
  f.context.add=async()=>{throw Error('Não pode chamar entrada no teste');};
  f.failAck();await f.queue.start(config,trial.context);await f.queue.poll();
  assert.equal(trial.entries().length,2);assert.equal(f.state().session.cursor,0);
  f.queue.blocked=false;await f.queue.poll();
  assert.equal(f.state().session.cursor,2);assert.equal(trial.entries().length,2);assert.equal(f.counted.size,0);
  assert.deepEqual(trial.totals(),{MT:5000,KG:250.5});
  f.setReads([{seq:1,uid},{seq:2,uid:second},{seq:3,uid}]);await f.queue.poll();
  assert.equal(trial.entries().length,2);assert.deepEqual(trial.totals(),{MT:5000,KG:250.5});assert.equal(f.state().session.cursor,3);
});
test('teste não registra consulta que terminou após trocar de usuário ou tela',async()=>{
  let active=true,release;
  const trial=createTestCount({scope:'teste-1',isActive:()=>active,lookup:()=>new Promise(resolve=>release=resolve)});
  const pending=applyItemReading({item:'T001',codigo:'0303410008',quantidade:'5000',unidade:'MT'},trial.context);
  await new Promise(resolve=>setImmediate(resolve));active=false;release({codigo:'0303410008',quantidade:5000,unidade:'MT'});
  await assert.rejects(pending,/mudou/);assert.equal(trial.entries().length,0);
});
test('destino de teste exige a aba NFC e não concede acesso a destinos de estoque',()=>{
  const {permitted}=require('../wms-nfc-workspace.js');
  assert.equal(permitted('v-nfc-test',['v-nfc']),true);
  assert.equal(permitted('v-nfc-test',['v-home']),false);
  assert.equal(permitted('v-floor70',['v-nfc']),false);
  assert.equal(permitted('v-floor70',['v-floor70']),true);
});
test('tag desconhecida bloqueia a sequência e fica pendente para correção',async()=>{
  const f=queueFixture();f.registry.delete(uid);await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,0);assert.equal(f.state().session.cursor,0);assert.equal(f.queue.blocked,true);
  f.registry.set(uid,'T001');f.queue.blocked=false;await f.queue.poll();assert.equal(f.counted.size,2);
});
test('resposta de confirmação perdida não soma embalagem novamente',async()=>{
  const f=queueFixture();f.failAck();await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.counted.size,2);assert.equal(f.state().session.cursor,0);
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
test('API resolve em lote somente UIDs da fila autorizada, sem revalidar senha por chip',async()=>{
  const f=apiFixture(),state={session:{target:'v-floor70'},items:[{seq:1,uid},{seq:2,uid:second}]};
  const fetcher=async(url,opts)=>{
    if(url.includes('/rpc/')){f.calls.push({url});return {ok:true,json:async()=>structuredClone(state)};}
    if(url.includes('/wms_nfc_tags?')){f.calls.push({url});return {ok:true,json:async()=>[{uid,item:'T001'},{uid:second,item:'T002'}]};}
    return f.options.fetcher(url,opts);
  };
  const result=await run(mobile({...f.options,fetcher}),{action:'count_status',data:{...config,cursor:0,uids:['53000000000000']}},{authorization:'Bearer '+f.token()});
  assert.equal(result.code,200);assert.equal(result.body.data.bindings.length,2);
  const query=new URL(f.calls.find(c=>c.url.includes('/wms_nfc_tags?')).url).searchParams;
  assert.equal(query.get('uid'),'in.('+uid+','+second+')');assert.equal(query.get('select'),'uid,item');
  assert.equal(f.calls.length,3);assert.ok(!f.calls.some(c=>new URL(c.url).searchParams.get('select')?.includes('p,')));
  f.setRole('consulta');const before=f.calls.length;
  assert.equal((await run(mobile({...f.options,fetcher}),{action:'count_status',data:{...config,cursor:0}},{authorization:'Bearer '+f.token()})).code,403);
  assert.equal(f.calls.length-before,2); // active user + scoped RPC, no bindings disclosure
});

test('fila usa o vínculo histórico da leitura após reutilização do chip e mantém desconhecidas pendentes',async()=>{
  const f=apiFixture(),state={session:{target:'v-floor70'},items:[{seq:1,uid,bound_item:'ETIQUETA-ANTIGA'},{seq:2,uid:second,bound_item:null}]};
  const fetcher=async(url,opts)=>{
    if(url.includes('/rpc/'))return {ok:true,json:async()=>structuredClone(state)};
    if(url.includes('/wms_nfc_tags?'))throw Error('Não pode trocar o vínculo histórico pelo cadastro atual');
    return f.options.fetcher(url,opts);
  };
  const result=await run(mobile({...f.options,fetcher}),{action:'count_status',data:{...config,cursor:0}},{authorization:'Bearer '+f.token()});
  assert.equal(result.code,200);assert.deepEqual(result.body.data.bindings,[{uid,item:'ETIQUETA-ANTIGA'}]);
  state.items[0].bound_item='<invalid>';assert.equal((await run(mobile({...f.options,fetcher}),{action:'count_status',data:{...config,cursor:0}},{authorization:'Bearer '+f.token()})).code,502);
});
test('rajada de 250 chips drena três páginas, confirma por lote e mantém os totais',async()=>{
  const f=queueFixture(),reads=Array.from({length:250},(_,i)=>({seq:i+1,uid:'53'+(i+1).toString(16).padStart(12,'0').toUpperCase()}));
  for(const event of reads){const id='B'+event.seq;f.registry.set(event.uid,id);f.catalog[id]={codigo:'0303410008',quantidade:1.25,unidade:'MT'};}
  f.setReads(reads);
  const base=f.options.api;
  f.options.api=async(a,d)=>{const s=await base(a,d);if(a==='count_status')s.bindings=s.items.map(e=>({uid:e.uid,item:f.registry.get(e.uid)}));return s;};
  let resolved=0;
  f.options.resolve=async(key,context,record)=>{assert.equal(record.uid,key);resolved++;return {item:record.item,codigo:'0303410008',quantidade:'1.25',unidade:'MT'};};
  const trial=createTestCount({scope:config.contextKey,isActive:()=>true,lookup:f.context.lookup});
  await f.queue.start(config,trial.context);await f.queue.poll();
  assert.equal(f.state().session.cursor,250);assert.equal(trial.entries().length,250);assert.deepEqual(trial.totals(),{MT:312.5});assert.equal(f.counted.size,0);
  assert.equal(resolved,250);assert.equal(f.calls.filter(c=>c.action==='count_status').length,3);assert.equal(f.calls.filter(c=>c.action==='count_ack').length,25);
  await f.queue.poll();assert.equal(resolved,250);assert.equal(trial.entries().length,250);
  const restored=new CountQueue({...f.options,apply:async()=>{throw Error('A consulta do histórico não pode reaplicar estoque');}});
  await restored.start(config,trial.context);
  for(let page=0;page<3;page++)await restored.loadHistory();
  assert.equal(restored.entries().length,250);assert.equal(restored.binding.historyCursor,250);
  assert.equal(restored.binding.historyError,'');assert.equal(f.calls.filter(c=>c.action==='count_ack').length,25);
});
test('tag desconhecida no meio do lote confirma só o prefixo válido e preserva o restante',async()=>{
  const f=queueFixture();f.registry.delete(second);await f.queue.start(config,f.context);await f.queue.poll();
  assert.deepEqual([...f.counted],['T001']);assert.equal(f.state().session.cursor,1);assert.equal(f.queue.blocked,true);
  f.registry.set(second,'T002');f.queue.blocked=false;await f.queue.poll();assert.equal(f.counted.size,2);assert.equal(f.state().session.cursor,2);
});

test('detalhes mostram código e peso do cadastro apenas depois da aplicação confirmada',async()=>{
  const f=queueFixture();f.registry.delete(second);
  await f.queue.start(config,f.context);await f.queue.poll();
  assert.deepEqual(f.queue.entries(),[{seq:1,uid,item:'T001',codigo:'0303450047',quantidade:'300',unidade:'KG',duplicate:false,confirmed:true}]);
  assert.equal(f.queue.blocked,true);assert.equal(f.state().session.cursor,1);
  f.catalog.T001.quantidade=999;
  assert.equal(f.queue.entries()[0].quantidade,'300');
  f.registry.set(second,'T002');f.queue.blocked=false;await f.queue.poll();
  assert.equal(f.queue.entries().length,2);assert.equal(f.queue.entries()[1].quantidade,'250.5');
  const g=queueFixture();g.context.add=async()=>{};
  await g.queue.start(config,g.context);await g.queue.poll();assert.deepEqual(g.queue.entries(),[]);
});

test('ACK perdido e tag repetida mantêm uma linha por embalagem e a unidade original',async()=>{
  const f=queueFixture();f.catalog.T001={codigo:'0303410008',quantidade:5000,unidade:'MT'};
  f.failAck();await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.queue.entries().length,2);assert.equal(f.queue.entries()[0].confirmed,false);
  f.queue.blocked=false;await f.queue.poll();assert.equal(f.queue.entries()[0].confirmed,true);
  f.setReads([{seq:1,uid},{seq:2,uid:second},{seq:3,uid}]);await f.queue.poll();
  assert.equal(f.queue.entries().length,2);assert.equal(f.queue.entries()[0].unidade,'MT');
  assert.equal(f.queue.entries()[0].codigo,'0303410008');assert.equal(f.queue.entries()[0].quantidade,'5000');
});

test('detalhes anteriores são recuperados sem reaplicar nem confirmar entradas de estoque',async()=>{
  const f=queueFixture();f.registry.delete(second);
  await f.queue.start(config,f.context);await f.queue.poll();await f.queue.pause();
  const acknowledgments=f.calls.filter(c=>c.action==='count_ack').length;
  const restored=new CountQueue({...f.options,apply:async()=>{throw Error('Não pode reaplicar estoque ao consultar detalhes');}});
  await restored.start(config,f.context);await restored.loadHistory();
  assert.equal(restored.entries().length,1);assert.equal(restored.entries()[0].codigo,'0303450047');
  assert.equal(restored.entries()[0].quantidade,'300');assert.equal(restored.entries()[0].confirmed,true);
  assert.equal(f.counted.size,1);assert.equal(f.calls.filter(c=>c.action==='count_ack').length,acknowledgments);
  assert.equal(restored.binding.historyCursor,1);assert.equal(restored.binding.historyError,'');
});

test('detalhe indisponível não transforma a consulta em entrada nem bloqueia novas leituras válidas',async()=>{
  const f=queueFixture();f.setReads([{seq:1,uid}]);
  await f.queue.start(config,f.context);await f.queue.poll();await f.queue.pause();
  f.registry.delete(uid);f.setReads([{seq:1,uid},{seq:2,uid:second}]);
  const restored=new CountQueue(f.options);await restored.start(config,f.context);await restored.loadHistory();
  assert.ok(restored.binding.historyError);assert.deepEqual(restored.entries(),[]);
  await restored.poll();assert.equal(f.state().session.cursor,2);assert.equal(restored.blocked,false);
  assert.equal(restored.entries()[0].item,'T002');assert.equal(f.counted.size,2);
});

test('retomar a mesma sessão preserva detalhes; sessão nova limpa a lista',async()=>{
  const f=queueFixture();await f.queue.start(config,f.context);await f.queue.poll();await f.queue.pause();
  await f.queue.start(config,f.context);assert.equal(f.queue.entries().length,2);
  assert.equal(f.queue.binding.historyCursor,2);
  await f.queue.pause();await f.queue.start({...config,sessionId:'44444444-4444-4444-8444-444444444444'},f.context);
  assert.deepEqual(f.queue.entries(),[]);
});

test('troca de tela durante a consulta dos detalhes descarta a resposta atrasada',async()=>{
  const f=queueFixture();f.setReads([{seq:1,uid}]);
  await f.queue.start(config,f.context);await f.queue.poll();await f.queue.pause();
  let release;
  const restored=new CountQueue({...f.options,resolve:()=>new Promise(resolve=>release=resolve)});
  await restored.start(config,f.context);const pending=restored.loadHistory();await new Promise(resolve=>setImmediate(resolve));
  f.deactivate();release({item:'T001',codigo:'0303450047',quantidade:'300',unidade:'KG'});await pending;
  assert.deepEqual(restored.entries(),[]);assert.equal(f.state().session.cursor,1);
});
test('ACK gravado com resposta perdida é repetido sem reaplicar qualquer embalagem',async()=>{
  const f=queueFixture(),base=f.options.api;let lose=true,applied=0,now=0;
  f.options.now=()=>now;f.options.apply=async(...args)=>{applied++;return applyItemReading(...args);};
  f.options.api=async(a,d)=>{const result=await base(a,d);if(a==='count_ack'&&lose){lose=false;throw Object.assign(Error('timeout'),{retryable:true});}return result;};
  await f.queue.start(config,f.context);await f.queue.poll();
  assert.equal(f.state().session.cursor,2);assert.equal(f.queue.binding.cursor,0);assert.equal(f.queue.blocked,false);assert.equal(applied,2);
  await f.queue.poll();assert.equal(f.queue.binding.cursor,0);now=1000;await f.queue.poll();
  assert.equal(f.queue.binding.cursor,2);assert.equal(applied,2);assert.equal(f.counted.size,2);
});
test('falha temporária de consulta se recupera com espera; falha de aplicação exige conferência',async()=>{
  const f=queueFixture(),base=f.options.api;let fail=true,now=0;
  f.options.now=()=>now;f.options.api=async(a,d)=>{if(a==='count_status'&&fail){fail=false;throw Object.assign(Error('offline'),{retryable:true});}return base(a,d);};
  await f.queue.start(config,f.context);await f.queue.poll();assert.equal(f.queue.blocked,false);assert.equal(f.counted.size,0);
  now=999;await f.queue.poll();assert.equal(f.counted.size,0);now=1000;await f.queue.poll();assert.equal(f.counted.size,2);
  const g=queueFixture();g.context.add=async()=>{throw Object.assign(Error('resultado de entrada incerto'),{retryable:true});};
  await g.queue.start(config,g.context);await g.queue.poll();assert.equal(g.queue.blocked,true);assert.equal(g.state().session.cursor,0);
});
test('vínculo fora da fila e alteração de quantidade não são confirmados',async()=>{
  for(const bad of ['uid','quantity']){
    const f=queueFixture(),base=f.options.api;
    if(bad==='uid')f.options.api=async(a,d)=>{const s=await base(a,d);if(a==='count_status')s.bindings=[{uid:'53000000000000',item:'T001'}];return s;};
    else f.options.resolve=async()=>({item:'T001',codigo:'0303450047',quantidade:'999',unidade:'KG'});
    await f.queue.start(config,f.context);await f.queue.poll();assert.equal(f.counted.size,0);assert.equal(f.queue.blocked,true);assert.equal(f.state().session.cursor,0);
  }
});
test('cliente diferencia falhas de transporte e renova token expirado uma vez',async()=>{
  let calls=0;
  const client=createClient({auth:()=>({u:'qa',p:'test'}),fetch:async(url,opts)=>{
    const body=JSON.parse(opts.body);calls++;
    if(body.action==='login')return {ok:true,status:200,json:async()=>({token:'test-token'})};
    if(calls===2)return {ok:false,status:401,json:async()=>({error:'expired'})};
    if(calls===4)throw Error('network detail');
    return {ok:true,status:200,json:async()=>({ok:true,data:[]})};
  }});
  await assert.rejects(client.request('count_status'),e=>e.retryable===true&&!e.message.includes('network detail'));assert.equal(calls,4);
  await client.request('reader_list');assert.equal(calls,5);
});
