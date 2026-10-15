(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.KitShippingCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function dateISO(value){
    var match=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/);
    if(!match)return '';
    var year=match[3].length===2?2000+Number(match[3]):Number(match[3]),month=Number(match[2]),day=Number(match[1]),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?String(year).padStart(4,'0')+'-'+match[2]+'-'+match[1]:'';
  }
  function normalizeLot(value){var match=String(value||'').trim().match(/^\d{1,3}\.\d{2}\/\d{2}$/);return match?match[0]:'';}
  function formatDate(iso){var match=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?match[3]+'/'+match[2]+'/'+match[1]:'';}
  function scanBorders(pixels,width,height,headerX,scale){
    var left=Math.round((headerX-2)*scale),right=Math.round((headerX+10)*scale),ys=[];
    if(left<0||right>=width)throw new Error('A coluna DATA está fora da página.');
    function dark(x,y){var index=(y*width+x)*4;return pixels[index]<240&&pixels[index+1]<240&&pixels[index+2]<240;}
    for(var y=0;y<height;y++)if(dark(left,y)&&dark(right,y))ys.push(y);
    var groups=[];ys.forEach(function(y){var last=groups[groups.length-1];if(last&&y-last[last.length-1]<=1)last.push(y);else groups.push([y]);});
    return groups.map(function(group){return height/scale-group[0]/scale;});
  }
  function parsePage(items,borders,page){
    var data=(items||[]).map(function(item){var t=item.transform||[];return {text:String(item.str||item.text||'').trim(),x:Number(t[4]!=null?t[4]:item.x),y:Number(t[5]!=null?t[5]:item.y),rotated:Math.abs(Number(t[0]||0))<Math.abs(Number(t[1]||0))};}).filter(function(item){return item.text&&Number.isFinite(item.x)&&Number.isFinite(item.y);});
    var header=data.find(function(item){return /^LOTE$/i.test(item.text);});
    var dates=data.filter(function(item){return item.rotated&&dateISO(item.text);}).map(function(item){return {date:dateISO(item.text),y:item.y};});
    var lots=data.filter(function(item){return normalizeLot(item.text)&&(!header||Math.abs(item.x-header.x)<35);});
    if(!dates.length||!lots.length)return {entries:[],dates:dates.length,lots:lots.length,unmatched:lots.length};
    var lines=(borders||[]).filter(Number.isFinite).slice().sort(function(a,b){return b-a;}).filter(function(value,index,list){return !index||Math.abs(list[index-1]-value)>2;});
    if(lines.length<dates.length+1)throw new Error('Não foi possível identificar as linhas que separam as datas no PDF.');
    function group(y){var count=0;for(var i=0;i<lines.length;i++)if(lines[i]>y)count++;return count;}
    var groups=new Map();dates.forEach(function(item){var key=group(item.y),list=groups.get(key)||[];list.push(item.date);groups.set(key,list);});
    var entries=[],unmatched=0;
    lots.forEach(function(item){var list=groups.get(group(item.y))||[],unique=Array.from(new Set(list));if(unique.length!==1){unmatched++;return;}entries.push({lot:normalizeLot(item.text),date:unique[0],page:page||1});});
    return {entries:entries,dates:dates.length,lots:lots.length,unmatched:unmatched};
  }
  function summarize(pages){
    var entries=[],unmatched=0,lots=0,days=0;(pages||[]).forEach(function(page){entries.push.apply(entries,page.entries||[]);unmatched+=page.unmatched||0;lots+=page.lots||0;days+=page.dates||0;});
    var byLot={};entries.forEach(function(entry){var dates=byLot[entry.lot]||(byLot[entry.lot]=[]);if(dates.indexOf(entry.date)<0)dates.push(entry.date);});Object.keys(byLot).forEach(function(lot){byLot[lot].sort();});
    return {entries:entries,byLot:byLot,unmatched:unmatched,lots:lots,days:days};
  }
  return {dateISO:dateISO,normalizeLot:normalizeLot,formatDate:formatDate,scanBorders:scanBorders,parsePage:parsePage,summarize:summarize};
});
