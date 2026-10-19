'use strict';
const {service,mayCount,fail,UUID,UID,respondError}=require('../server/nfc-mobile-core.js');
function parse(req){
  const max=512*1024;if(Number(req.headers['content-length'])>max)throw fail(413,'Inventário excede o limite.');
  let body=req.body;if(typeof body==='string'){if(Buffer.byteLength(body)>max)throw fail(413,'Inventário excede o limite.');try{body=JSON.parse(body);}catch{throw fail(400,'JSON inválido.');}}
  if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>max)throw fail(400,'Inventário inválido.');
  const data=body.data||{};
  if(!['inventory_list','inventory_get','inventory_finish'].includes(body.action)||!UUID.test(data.readerId||''))throw fail(400,'Operação de inventário inválida.');
  if(body.action!=='inventory_list'&&!UUID.test(data.sessionId||''))throw fail(400,'Inventário inválido.');
  if(body.action==='inventory_list'&&(!Number.isSafeInteger(data.offset)||data.offset<0||data.offset>100000))throw fail(400,'Página de inventários inválida.');
  if(body.action==='inventory_finish'){
    if(!UUID.test(data.consumerId||'')||!Array.isArray(data.entries)||data.entries.length>1000)throw fail(400,'Resultado do inventário inválido.');
    const items=new Set();data.entries=data.entries.map(entry=>{
      if(!entry||!Number.isSafeInteger(entry.seq)||entry.seq<1||entry.seq>1000||!UID.test(entry.uid||'')||typeof entry.item!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(entry.item)||items.has(entry.item)||typeof entry.codigo!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(entry.codigo)||typeof entry.quantidade!=='string'||!/^\d{1,9}(?:\.\d{1,6})?$/.test(entry.quantidade)||Number(entry.quantidade)<=0||!['KG','G','MT','UN','L','ML','M2','M3'].includes(entry.unidade))throw fail(400,'Confira código, quantidade e unidade de cada embalagem.');
      items.add(entry.item);return {seq:entry.seq,uid:entry.uid,item:entry.item,codigo:entry.codigo,quantidade:entry.quantidade,unidade:entry.unidade};
    });
  }
  return body;
}
function makeHandler(options={}){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método não permitido.'});
  try{
    const app=service(options);app.check(req);const body=parse(req),actor=await app.authenticate(req);
    if(!mayCount(actor.role,'v-inv'))throw fail(403,'Usuário sem acesso ao inventário.');
    const data=await app.db('rpc/wms_nfc_inventory',{p_action:body.action,p_actor:actor.u,p_payload:body.data});
    if(data?.reason==='pending')throw fail(409,'Há leituras pendentes. Retome o inventário e processe a fila antes de encerrar.');
    if(data?.reason==='snapshot')throw fail(409,'Atualize os detalhes do inventário antes de encerrar. O resultado ainda não está completo.');
    return res.status(200).json({ok:true,data});
  }catch(error){return respondError(res,error);}
};}
module.exports=makeHandler();module.exports._test={makeHandler,parse};
