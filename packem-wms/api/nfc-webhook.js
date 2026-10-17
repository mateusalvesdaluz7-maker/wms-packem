'use strict';
const {service,bodyOf,normalizeUid,hash,fail,mayBind,mayCount,respondError}=require('../server/nfc-mobile-core.js');
function makeHandler(options={}){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Use o leitor NFC.cool para enviar a leitura.'});
  try{
    const app=service(options);app.check(req);
    const key=req.query?.key;
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw fail(401,'Link do leitor inválido. Gere a conexão no WMS.');
    const secretHash=hash(key), rows=await app.db('wms_nfc_readers?'+new URLSearchParams({select:'id,owner,mode,target,active,expires_at',secret_hash:'eq.'+secretHash,limit:'1'}));
    const reader=Array.isArray(rows)?rows[0]:null;
    if(!reader||!reader.active||Date.parse(reader.expires_at)<=Date.now())throw fail(401,'O link do leitor expirou ou foi revogado. Reconecte no WMS.');
    const actor=await app.user(reader.owner), body=bodyOf(req);
    const probe=body.identifier==='xx:xx:xx:xx'&&body.content==='Awesome it worked!';
    if(!probe){
      if(reader.mode==='enroll'&&!mayBind(actor.role))throw fail(403,'O usuário não pode cadastrar tags.');
      if(reader.mode==='count'&&!mayCount(actor.role,reader.target))throw fail(403,'O usuário não pode contar neste destino.');
    }
    const uid=probe?null:normalizeUid(body.identifier);
    if(!probe&&(typeof body.date!=='string'||body.date.length>64||!Number.isFinite(Date.parse(body.date))))throw fail(400,'A leitura está sem data válida.');
    // NDEF content is deliberately ignored: product and quantity come from WMS.
    const result=await app.rpc('ingest',actor.u,{readerId:reader.id,secretHash,uid,probe,scannedAt:probe?null:body.date});
    res.setHeader('X-NFC-Result',result?.duplicate?'duplicate':'accepted');
    return res.status(204).end();
  }catch(error){return respondError(res,error);}
};}
module.exports=makeHandler();module.exports._test={makeHandler};
