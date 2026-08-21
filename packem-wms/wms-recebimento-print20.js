(function(){
'use strict';
var batchIndex=0;
function pending(){
  return (typeof window.STAGE!=='undefined'&&Array.isArray(window.STAGE))?window.STAGE:[];
}
function authorized(){
  try{return typeof window.isAdmin!=='function'||window.isAdmin();}catch(e){return false;}
}
function labelText(){
  var total=pending().length;
  if(!total)return 'Imprimir etiquetas';
  var pages=Math.ceil(total/20);
  if(batchIndex>=pages)batchIndex=0;
  var from=batchIndex*20+1,to=Math.min(total,(batchIndex+1)*20);
  return 'Imprimir etiquetas '+from+'–'+to+' de '+total;
}
function makePrintRows(rows){
  return rows.map(function(s){
    var et=typeof window.norm==='function'?window.norm(s.et):String(s.et||'').trim();
    var o=(window.BOB&&window.BOB[et])?window.BOB[et]:{};
    var item={
      et:et,
      pr:o.pr||s.pr||'',
      desc:(typeof window.convDescByCod==='function'&&window.convDescByCod(o.pr||s.pr))||o.desc||s.desc||'',
      pl:o.pl!=null?o.pl:s.pl
    };
    return typeof window._intakeToRast==='function'?window._intakeToRast(item):{
      id:item.et,cProd:item.pr,xProd:item.desc,kg:Number(item.pl)||0,bobina:item.et,nf:'__vaga__'
    };
  }).filter(function(x){return x&&x.id;});
}
function printNext(){
  if(!authorized()){if(typeof window.toast==='function')window.toast('Somente usuários autorizados podem imprimir etiquetas',false);return;}
  var all=pending().slice();
  if(!all.length){if(typeof window.toast==='function')window.toast('Não há etiquetas pendentes no recebimento',false);return;}
  var pages=Math.ceil(all.length/20);
  if(batchIndex>=pages)batchIndex=0;
  var from=batchIndex*20,to=Math.min(all.length,from+20);
  var rows=makePrintRows(all.slice(from,to));
  if(!rows.length){if(typeof window.toast==='function')window.toast('Nenhuma etiqueta válida para imprimir',false);return;}
  try{
    var opt=typeof window.expLabelFmt==='function'?window.expLabelFmt():{dim:{w:100,h:100},orient:'retrato'};
    if(typeof window.printZebraRast!=='function')throw new Error('Impressão indisponível');
    window.printZebraRast(rows,opt.dim,opt.orient==='paisagem'?'paisagem':'retrato');
    batchIndex=(batchIndex+1)%pages;
    if(typeof window.toast==='function')window.toast('Etiquetas '+(from+1)+'–'+to+' preparadas. Próximo grupo: '+labelText());
    refresh();
  }catch(e){
    console.error('impressão em lote',e);
    if(typeof window.toast==='function')window.toast('Não foi possível preparar as etiquetas',false);
  }
}
function refresh(){
  var host=document.getElementById('recvBf70');
  if(!host)return;
  var box=host.parentElement;
  if(!box)return;
  var btn=document.getElementById('recvPrintBatch20');
  if(!btn){
    btn=document.createElement('button');
    btn.id='recvPrintBatch20';
    btn.className='btn brand';
    btn.style.cssText='font-size:.76rem;padding:9px 13px';
    btn.addEventListener('click',printNext);
    box.insertBefore(btn,host);
  }
  btn.textContent='🖨 '+labelText();
  btn.disabled=!pending().length;
}
var observer=new MutationObserver(function(){refresh();});
function start(){
  observer.observe(document.body,{childList:true,subtree:true});
  refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
else start();
})();