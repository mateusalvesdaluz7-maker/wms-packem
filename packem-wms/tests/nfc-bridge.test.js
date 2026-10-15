'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {mapLabels,validReply}=require('../wms-nfc-bridge.js');
const rows=[{id:'T0001',cProd:'0303410008',kg:6300,uCom:'MT'},{id:'T0002',cProd:'00123',kg:6.3,uCom:'KG'}];
test('dados NFC saem dos mesmos IDs, códigos, quantidades e unidades usados na impressão',()=>{
  const jobs=mapLabels(rows,row=>row.uCom);
  assert.equal(jobs[0].codigo,'0303410008');assert.equal(jobs[0].quantidade,'6300');assert.equal(jobs[0].unidade,'MT');
  assert.equal(jobs[1].codigo,'00123');assert.equal(jobs[1].quantidade,'6.3');assert.equal(jobs[1].unidade,'KG');
  assert.throws(()=>mapLabels([rows[0],rows[0]],row=>row.uCom));
  assert.throws(()=>mapLabels([{...rows[0],kg:0}],row=>row.uCom));
  assert.throws(()=>mapLabels([{...rows[0],cProd:''}],row=>row.uCom));
  assert.throws(()=>mapLabels(rows,()=>''));
});
test('mensagens precisam vir da janela local, origem exata e conexão atual',()=>{
  const station={},event={source:station,origin:'http://127.0.0.1:8788',data:{linkId:'atual'}};
  assert.ok(validReply(event,station,event.origin,'atual'));
  assert.equal(validReply({...event,source:{}},station,event.origin,'atual'),false);
  assert.equal(validReply({...event,origin:'https://outro.example'},station,event.origin,'atual'),false);
  assert.equal(validReply(event,station,event.origin,'antigo'),false);
});
function client(){
  let handler,printed=0,popupURL;const messages=[],values=new Map(),station={closed:false,postMessage:message=>messages.push(message)};
  const root={addEventListener:(type,fn)=>handler=fn,open:url=>{popupURL=url;return station;},toast:()=>{}};
  const context={window:root,document:{getElementById:()=>null},crypto:require('node:crypto'),Set,Map,Promise,setTimeout,clearTimeout,
    sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../wms-nfc-bridge.js'),'utf8'),context);
  return {root,messages,station,print:()=>printed++,get printed(){return printed;},get linkId(){return new URL(popupURL).searchParams.get('linkId');},reply(data){handler({source:station,origin:'http://127.0.0.1:8788',data});}};
}
test('impressão só é liberada depois do ACK e um duplo clique não duplica o bloco',async()=>{
  const c=client();c.root.WmsNfcBridge.connect();
  c.reply({type:'packem-nfc-ready',linkId:c.linkId});
  const operation=c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom);
  c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom);
  assert.equal(c.messages.length,1);assert.equal(c.printed,0);
  c.reply({type:'packem-nfc-accepted',linkId:c.linkId,requestId:c.messages[0].requestId,count:2});
  await operation;assert.equal(c.printed,1);
  c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom);assert.equal(c.printed,1);
});
test('sem conexão ou com erro de recepção não imprime; tentativa seguinte conserva o identificador',async()=>{
  const c=client();c.root.WmsNfcBridge.connect();
  await c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom);assert.equal(c.printed,0);
  c.reply({type:'packem-nfc-ready',linkId:c.linkId});
  const operation=c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom),id=c.messages[0].requestId;
  c.reply({type:'packem-nfc-error',linkId:c.linkId,requestId:id,error:'Fila pausada'});await operation;
  assert.equal(c.printed,0);
  const retry=c.root.WmsNfcBridge.beforePrint(rows,c.print,row=>row.uCom);
  assert.equal(c.messages[1].requestId,id);
  c.reply({type:'packem-nfc-accepted',linkId:c.linkId,requestId:id,count:2});await retry;assert.equal(c.printed,1);
});
test('hook real envia apenas o primeiro bloco quando o operador cancela os seguintes',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../wms-app.js'),'utf8');
  const begin=source.indexOf('function printZebraEtq('),end=source.indexOf('function printZebraRast(',begin);
  const received=[],printed=[];let confirms=0;
  const context={window:{WmsNfcBridge:{beforePrint:(part,print)=>{received.push(part.map(row=>row.id));return print();}}},
    toast:()=>{},ZSIZES:{z100:{w:100,h:100}},ZBLOCO:40,
    zEtqCard:e=>e.id,zEtqCSS:()=>'',printDoc:(html,css,after)=>{printed.push(html);if(after)after();},
    confirm:()=>++confirms===1,setTimeout:fn=>fn(),loadQR:()=>({then:fn=>{fn();return {catch:()=>{}};}})};
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
  context.printZebraEtq(Array.from({length:81},(_,index)=>({id:'T'+index})),{w:100,h:100},'rast');
  assert.equal(received.length,1);assert.equal(received[0].length,40);assert.equal(printed.length,1);
});
