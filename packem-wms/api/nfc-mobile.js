'use strict';
const crypto=require('node:crypto');
const {service,bodyOf,mayBind,mayCount,fail,hash,UUID,targets,respondError}=require('../server/nfc-mobile-core.js');
function makeHandler(options={}){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método não permitido.'});
  try{
    const app=service(options);app.check(req);const body=bodyOf(req), action=body.action;
    if(action==='login'){
      if(!body.auth||typeof body.auth.u!=='string'||!body.auth.u||body.auth.u.length>120||typeof body.auth.p!=='string'||!body.auth.p||body.auth.p.length>1000)throw fail(401,'Entre novamente no WMS.');
      const actor=await app.user(body.auth.u,body.auth.p);
      return res.status(200).json({ok:true,token:app.issue(actor)});
    }
    const actions=['reader_create','reader_list','reader_get','reader_rotate','reader_revoke','enroll_arm','enroll_cancel','count_start','count_status','count_stop','count_ack'];
    if(!actions.includes(action))throw fail(400,'Ação NFC inválida.');
    const actor=await app.authenticate(req), data=body.data||{};
    if(typeof data!=='object'||Array.isArray(data))throw fail(400,'Dados NFC inválidos.');
    if(action==='reader_create'||action==='reader_list'){
      if(!mayBind(actor.role)&&!targets.some(target=>mayCount(actor.role,target)))throw fail(403,'Usuário sem acesso ao leitor NFC.');
    }else if(!UUID.test(data.readerId||''))throw fail(400,'Conecte primeiro o leitor do celular.');
    if(action==='enroll_arm'){
      if(!mayBind(actor.role))throw fail(403,'Usuário sem permissão para cadastrar etiquetas.');
      if(!UUID.test(data.operationId||'')||typeof data.item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(data.item))throw fail(400,'Escolha uma embalagem existente para cadastrar a tag.');
    }
    if(action==='enroll_cancel'&&!UUID.test(data.operationId||''))throw fail(400,'Operação de cadastro inválida.');
    if(action.startsWith('count_')){
      if(!UUID.test(data.sessionId||''))throw fail(400,'Sessão de contagem inválida.');
      if(action==='count_start'&&(!mayCount(actor.role,data.target)||typeof data.contextKey!=='string'||!data.contextKey||data.contextKey.length>200))throw fail(403,'Abra uma contagem autorizada antes de conectar o leitor.');
      if(['count_status','count_ack'].includes(action)&&(!Number.isSafeInteger(data.cursor)||data.cursor<0||data.cursor>1000))throw fail(400,'Posição de leitura inválida.');
    }
    let secret;
    const payload={...data};
    if(['reader_create','reader_rotate'].includes(action)){
      secret=crypto.randomBytes(32).toString('base64url');payload.secretHash=hash(secret);
      if(action==='reader_create'){payload.readerId=crypto.randomUUID();payload.label='iPhone · '+actor.u;}
    }
    const result=await app.rpc(action,actor.u,payload);
    if(result?.session&&!mayCount(actor.role,result.session.target))throw fail(403,'Usuário sem acesso a este destino.');
    if(secret){
      const origin=req.headers.origin||'https://wms-packem.vercel.app';
      result.webhookUrl=origin+'/nfc-receber/'+secret;
    }
    return res.status(200).json({ok:true,data:result});
  }catch(error){return respondError(res,error);}
};}
module.exports=makeHandler();module.exports._test={makeHandler};
