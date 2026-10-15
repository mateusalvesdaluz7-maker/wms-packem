(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.CutSheetCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function clean(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/�/g,'').replace(/\s+/g,' ').trim();}
  function num(s){var v=String(s||'0').trim();return Number(v.indexOf(',')>=0?v.replace(/\./g,'').replace(',','.'):v)||0;}
  function family(s){var v=clean(s);if(/^(TPL|TEC\.?\s*PLANO.*LAM)/.test(v))return 'laminado-plano';if(/^(TBL|TEC\.?\s*TUBULAR.*LAM)/.test(v))return 'laminado-tubular';if(/^(TB\s*\d|TEC\.?\s*TUBULAR)/.test(v))return 'tubular';if(/^(TP\s*\d|TEC\.?\s*PLANO)/.test(v))return 'plano';if(/^(ALCA)/.test(v))return 'alca';if(/^(CADARCO)/.test(v))return 'cadarco';if(/^(LINER|FILME)/.test(v))return 'filme';if(/^(FIO|LINHA)/.test(v))return 'fio';if(/^(ADESIVO)/.test(v))return 'adesivo';if(/^(PORTA DOC)/.test(v))return 'porta';if(/^(FOLHETO)/.test(v))return 'folheto';return '';}
  function properties(s,context){var v=clean(s),c=clean(context),f=family(v),color='';
    if(/CARIJO\s*VERDE|\bCVD\b/.test(v))color='CVD';else if(/CARIJO\s*MARROM|\bCMA\b/.test(v))color='CMA';else if(/CARIJO\s*AMAREL[AO]|\bCAM\b/.test(v))color='CAM';else if(/\bBRANCO\b|\bBRANCA\b|\bBR\b/.test(v))color='BR';else if(/TRANSPARENTE|\bTRANSP\b/.test(v))color='TRANS';
    var polymer=/\bPES\b|\bPET\b|\bPETREFILAR\b/.test(v)?'PET':/\bPP\b/.test(v)?'PP':/\bPET\b/.test(c)?'PET':/\bPP\b/.test(c)?'PP':'';
    var width='',g='';
    if(f==='tubular'||f==='plano'||f.indexOf('laminado-')===0){
      var gm=v.match(/\b(\d{2,3})\s*G?\s*\+\s*(\d{1,3})\s*G\b/)||v.match(/\b(\d{2,3})\s*G\b/);if(gm)g=gm[1]+(gm[2]?'+'+gm[2]:'');
      var wm=v.match(/(?:X\s*)?(\d{2,3})\s*CM/);if(wm)width=wm[1];
    }else if(f==='filme'){
      var lm=v.match(/\b(\d{2,3})\s*CM\b/);if(lm)width=lm[1];
      var ep=v.match(/0[,.]0?(\d{2,3})\s*MM/);if(ep)g='0.'+ep[1].padStart(3,'0');
    }else if(f==='alca'||f==='cadarco'){
      var mw=v.match(/\b(\d{2,4})\s*(?:KGF|MM)\b/);if(mw)width=mw[1];
    }
    return {family:f,color:color,polymer:polymer,width:width,grammage:g,weightG:(f==='alca'||f==='cadarco')?((v.match(/\b(\d{1,3})\s*G\b/)||[])[1]||''):'',virgin:/100\s*%\s*VIRGEM/.test(v),cut:/C\s*\/\s*SOLDA|CORTAD|SOLDAD/.test(v),natural:/NATURAL/.test(v),transparent:/TRANSPARENTE|\bTRANSP\b/.test(v),opaque:/LEITOSO|OPACO/.test(v),denier:(v.match(/\b(\d{4})\s*(?:DENIER|DTEX)\b/)||[])[1]||'',text:v};
  }
  function stepKey(label,fam){var v=clean(label);if(fam==='cadarco')return /FLAP/.test(v)?'cadarco_flap':/SAIA/.test(v)?'cadarco_saia':/TOPO/.test(v)?'cadarco_valvula_topo':/FUNDO/.test(v)?'cadarco_valvula_fundo':'cadarco';
    if(fam==='laminado-tubular')return /FLAP|REFILAD/.test(v)?'flap_fundo':v==='TOPO'?'topo':/TOPO/.test(v)?'valvula_topo':/FUNDO/.test(v)?'valvula_fundo':'valvula';
    if(fam==='laminado-plano')return /SAIA/.test(v)?'saia':'topo';if(fam==='plano')return 'fundo';if(fam==='tubular')return 'corpo';if(fam==='alca')return 'alca';if(fam==='filme')return 'liner';return fam;
  }
  function operationsFromPage(page){var lines=String(page||'').split(/\r?\n/),out=[];lines.forEach(function(line,i){var m=line.match(/OP\s*:\s*(\d{8,})/i);if(!m)return;var ctx=clean(lines.slice(Math.max(0,i-3),Math.min(lines.length,i+4)).join(' ')),key='';
      if(/CADARCO/.test(ctx))key=/SAIA/.test(ctx)?'cadarco_saia':/FLAP/.test(ctx)?'cadarco_flap':/TOPO/.test(ctx)?'cadarco_valvula_topo':/FUNDO/.test(ctx)?'cadarco_valvula_fundo':'';
      else if(/ALCA/.test(ctx))key='alca';else if(/LINER/.test(ctx))key='liner';else if(/FLAP/.test(ctx))key='flap_fundo';else if(/VALVULA|VALV\b/.test(ctx))key=/TOPO/.test(ctx)?'valvula_topo':/FUNDO/.test(ctx)?'valvula_fundo':'';
      else if(/CORPO/.test(ctx))key='corpo';else if(/SAIA/.test(ctx))key='saia';else if(/TOPO/.test(ctx))key='topo';else if(/FUNDO/.test(ctx))key='fundo';
      out.push({code:m[1],key:key});
    });return out;
  }
  function operationQuantitiesFromPage(page){var lines=String(page||'').split(/\r?\n/),result={};
    lines.forEach(function(line,index){var op=(line.match(/OP\s*:\s*(\d{8,})/i)||[])[1];if(!op)return;
      for(var offset=0;offset<=2;offset++){var before=lines[index-offset].split(/OP\s*:/i)[0],values=Array.from(before.matchAll(/(?:^|[^\d,.])(\d{3,7})(?![\d,.])/g)).map(function(match){return match[1];}),quantity=Number(values[values.length-1]);
        if(quantity>0){result[op]=quantity;break;}
      }
    });return result;
  }
  function extract(lines){var pages=Array.isArray(lines)?lines:[String(lines||'')],p0=pages[0]||'',all=pages.join('\n'),technical=pages.find(function(p){return /PESO TE.RICO/i.test(clean(p))&&/MATERIA PRIMA/i.test(clean(p));})||all;
    var ap=(all.match(/\bAP\s*(\d{1,5})\s*\((\d{1,3})\)/i)||[]),clientMatches=Array.from(all.matchAll(/CLIENTE[ \t]*:[ \t]*([^\n]+)/gi)).map(function(m){return m[1].replace(/\s+DATA DE.*$/i,'').trim();}),client=clientMatches.sort(function(a,b){return a.length-b.length;})[0]||'',lot=(p0.match(/LOTE[ \t]*:[ \t]*([^\n]*)/i)||[])[1]||'',q=(p0.match(/\b(\d{1,7})\s*\nFITEC\s*:/i)||[])[1]||(all.match(/QTDE\s*PE.AS[ \t]*:[ \t]*(\d+)/i)||[])[1]||'';
    if(!/^\d{1,3}\.\d{2}\/\d{2}$/.test(lot.trim()))lot=(p0.match(/\b\d{1,3}\.\d{2}\/\d{2}\b/)||[])[0]||'';
    var opDetails=operationsFromPage(p0),ops=opDetails.map(function(x){return x.code;});
    var begin=technical.search(/MAT[ÉE]RIA PRIMA/i),end=technical.search(/PESO TE.RICO/i);if(begin>=0)technical=technical.slice(begin,end>begin?end:undefined);
    var rows=[];technical.split(/\r?\n/).forEach(function(line){var m=line.match(/\b(0[,.]\d{2,20})\s+((?:TB|TP|TPL|TBL|AL[AÇC]A|CADAR[CÇ]O|FIO|LINER|FILME|ADESIVO|PORTA DOC|FOLHETO)[^\n]*)$/i);if(!m)return;var desc=m[2].trim(),src=line.slice(0,m.index).trim(),fam=family(desc);if(!fam)return;
      var qty=fam==='alca'?(Number((src.match(/(?:AL[AÇC]A)\s+(\d+)\s/i)||[])[1])||4):1;
      var dim=(src.match(/\b\d+[,.]\d+\s+X\s+\d+[,.]\d+/i)||[])[0]||'';
      var labels=src.match(/(?:CADAR[CÇ]O\s+(?:V[ÁA]LVULA\s+|V[ÁA]LV\s+)?(?:FUNDO|TOPO|FLAP|SAIA)|V[ÁA]LVULA\s+(?:FUNDO|TOPO)|FLAP(?:\s+FUNDO|\s+TUBULAR\s+REFILADO)?|CORPO|AL[AÇC]A|FUNDO|TOPO|SAIA|LINER|LINHA|ADESIVO|PORTA\s+DOCUMENTO|FOLHETO)/ig)||[],item=labels[labels.length-1]||fam;
      var lengthMatch=src.match(/(?:AL[AÇC]A|CADAR[CÇ]O)[^\n]*?\b\d+\s+(\d+[,.]\d+)/i);
      var label=item.replace(/\s+/g,' ').trim();if(fam==='laminado-tubular'&&/TUBULAR\s+REFILADO/i.test(src))label='FLAP FUNDO';var key=stepKey(label,fam),op=(opDetails.find(function(x){return x.key===key;})||{}).code||'';
      rows.push({label:label,stepKey:key,op:op,description:desc,weightPerBag:num(m[1]),piecesPerBag:qty,lengthPerPiece:lengthMatch?num(lengthMatch[1]):0,dimensions:dim,sourceLine:line.trim(),family:fam});
    });
    var header=clean(all.slice(0,Math.min(all.length,4000))),polymer=/COR\s*\/\s*TECIDO\s*:\s*[^\n]*\bPET\b/.test(header)?'PET':/COR\s*\/\s*TECIDO\s*:\s*[^\n]*\bPP\b/.test(header)?'PP':'';
    return {ap:ap[1]||'',revision:ap[2]||'',client:client.trim(),lot:lot.trim(),quantity:Number(q)||0,operations:ops,operationDetails:opDetails,operationQuantities:operationQuantitiesFromPage(p0),polymer:polymer,theoreticalKg:num((all.match(/PESO TE.RICO\s+(\d+[,.]\d+)/i)||[])[1]),rows:rows,pageCount:pages.length};
  }
  function score(source,candidate,context){var a=properties(source,context),b=properties(candidate.description||candidate,context),why=[];
    if(!a.family||!b.family||a.family!==b.family)return {score:-999,why:['Família diferente']};
    if(a.family==='filme'&&(!/^FILME\b/.test(b.text)||b.cut))return {score:-999,why:['Liner cortado/soldado não é matéria-prima']};
    if(a.family==='alca'&&(/\bAU\.?\s*\d|\bAC\.?\s*\d|\b\d{2,3}\s*CM\b/.test(b.text)))return {score:-999,why:['Alça já cortada, não matéria-prima em rolo']};
    if(a.family==='cadarco'&&/\b\d{2,3}\s*CM\b/.test(b.text))return {score:-999,why:['Cadarço já cortado, não matéria-prima em rolo']};
    if(a.color&&b.color&&a.color!==b.color)return {score:-999,why:['Cor diferente']};
    if(a.polymer&&b.polymer&&a.polymer!==b.polymer)return {score:-999,why:['Polímero diferente']};
    if(a.width&&b.width&&a.width!==b.width)return {score:-999,why:['Largura/medida diferente']};
    if(a.grammage&&b.grammage&&a.grammage!==b.grammage)return {score:-999,why:['Gramatura/espessura diferente']};
    if(a.weightG&&b.weightG&&a.weightG!==b.weightG)return {score:-999,why:['Peso da alça/cadarço diferente']};
    if(a.virgin&&!b.virgin)return {score:-999,why:['Ficha exige 100% virgem']};
    if(a.transparent&&b.opaque)return {score:-999,why:['Filme opaco, ficha exige transparente']};
    if(a.denier&&b.denier&&a.denier!==b.denier)return {score:-999,why:['Título do fio diferente']};
    var n=10;if(a.color&&b.color)n+=15;if(a.polymer&&b.polymer)n+=15;if(a.width&&b.width)n+=20;if(a.grammage&&b.grammage)n+=20;if(a.virgin&&b.virgin)n+=10;
    if(a.family==='filme'&&/FILME/.test(b.text))n+=10;
    if(a.transparent&&b.transparent)n+=15;
    if(a.denier&&b.denier)n+=20;
    if(a.family==='alca'&&/\bPP\b/.test(b.text)&&/\bPET\b/.test(a.text))return {score:-999,why:['Material da alça difere da ficha']};
    if(!a.color&&b.color)why.push('Cor não informada na composição');
    if(!a.polymer&&b.polymer)why.push('Polímero não informado na composição');
    return {score:n,why:why};
  }
  function candidates(row,catalog,context){var list=[];for(var i=0;i<catalog.length;i++){var c=catalog[i];if(!c||!c.code||!c.count)continue;var r=score(row.description,c.description,context);if(r.score<0)continue;list.push({code:c.code,description:c.description,count:c.count,score:r.score,why:r.why});}
    list.sort(function(a,b){return b.score-a.score||b.count-a.count||a.code.localeCompare(b.code);});return list.slice(0,25);
  }
  function recommend(row,catalog,context){var cs=candidates(row,catalog,context),code='',notice='';
    var p=properties(row.description,context);
    if(p.family==='plano'&&p.grammage==='140'&&p.width==='97'){code='0303550015';notice='Regra confirmada: TP 140 g × 97 cm';}
    if(p.family==='alca'&&/1000/.test(p.text)&&/\bPP\b/.test(p.text)&&p.color==='BR'){code='0303410008';notice='Código de alça branca confirmado';}
    if(code){var exact=cs.find(function(c){return c.code===code;});if(exact)return {candidates:cs,code:code,notice:notice,confirmed:true};}
    var top=cs[0];if(top&&top.score>=60)return {candidates:cs,code:top.code,notice:'Sugestão por compatibilidade e frequência; confira a descrição',confirmed:false};
    return {candidates:cs,code:'',notice:cs.length?'Escolha o código após conferir a ficha':'Sem correspondência segura'};
  }
  function aggregate(sheet,choices){var map=new Map();sheet.rows.forEach(function(row,i){var code=choices[i];if(!code)return;var key=code,entry=map.get(key)||{code:code,description:row.description,kg:0,source:[],quantity:0};entry.kg+=row.weightPerBag*sheet.quantity;entry.source.push(row.label);entry.quantity+=row.piecesPerBag*sheet.quantity;map.set(key,entry);});return Array.from(map.values()).map(function(x){x.kg=Math.round(x.kg*1000)/1000;return x;});}
  function isCut(row){return ['tubular','plano','laminado-tubular','laminado-plano','alca','cadarco','filme'].indexOf(row.family)>=0;}
  function consumption(row){var f=row.family,qty=row.piecesPerBag||1,dimensions=String(row.dimensions||'').match(/(\d+[,.]\d+)\s*X\s*(\d+[,.]\d+)/i),spec=clean(row.description),kg=NaN,metres=0,formula='';
    if((f==='tubular'||f==='plano'||f==='laminado-tubular'||f==='laminado-plano')&&dimensions){
      var g=spec.match(/\b(\d{2,3})\s*G?\s*\+\s*(\d{1,3})\s*G\b/)||spec.match(/\b(\d{2,3})\s*G\b/);
      if(g){var length=num(dimensions[1]),width=num(dimensions[2]),gsm=Number(g[1])+(g[2]?Number(g[2]):0),walls=f==='laminado-tubular'||f==='tubular'&&/\bTUBULAR\b/.test(spec)?2:1;
        // A largura do corpo tubular na ficha já é o perímetro aberto. Válvulas TBL têm duas paredes.
        if(f==='tubular')walls=1;
        kg=length*width*gsm/1000*qty*walls;metres=length*qty;formula=length+' × '+width+' × '+gsm+'/1000 × '+qty+(walls===2?' × 2':'');
      }
    }else if((f==='alca'||f==='cadarco')&&row.lengthPerPiece){
      var grams=(spec.match(/\b(\d{1,3})\s*G\b/)||[])[1];metres=row.lengthPerPiece*qty;if(grams){kg=metres*Number(grams)/1000;formula=row.lengthPerPiece+' × '+qty+' × '+grams+'/1000';}
    }else if(f==='filme'&&dimensions){
      var thick=spec.match(/\b0[,.](\d{2,3})\s*MM\b/);if(thick){var mm=num('0,'+thick[1]);kg=num(dimensions[1])*num(dimensions[2])*mm*.920*qty;metres=num(dimensions[1])*qty;formula=num(dimensions[1])+' × '+num(dimensions[2])+' × '+mm+' × 0,920 × '+qty;}
    }
    return {kgPerBag:Number.isFinite(kg)?kg:null,metresPerBag:metres,formula:formula,sourceWeight:row.weightPerBag};
  }
  function groups(sheet){var map=new Map();sheet.rows.filter(isCut).forEach(function(row){var k=clean(row.description),g=map.get(k)||{description:row.description,family:row.family,weightPerBag:0,sourceWeightPerBag:0,metresPerBag:0,piecesPerBag:0,rows:[],labels:[],calculations:[],missingFormula:false,discrepancy:false},c=consumption(row);g.weightPerBag+=c.kgPerBag===null?0:c.kgPerBag;g.sourceWeightPerBag+=row.weightPerBag;g.metresPerBag+=c.metresPerBag;g.piecesPerBag+=row.piecesPerBag;g.rows.push(row);g.labels.push(row.label);g.calculations.push({label:row.label,op:row.op,kgPerBag:c.kgPerBag,metresPerBag:c.metresPerBag,formula:c.formula,sourceWeight:c.sourceWeight});if(c.kgPerBag===null)g.missingFormula=true;else if(Math.abs(c.kgPerBag-row.weightPerBag)>Math.max(.001,row.weightPerBag*.02))g.discrepancy=true;map.set(k,g);});return Array.from(map.values());}
  return {clean:clean,num:num,properties:properties,extract:extract,score:score,candidates:candidates,recommend:recommend,aggregate:aggregate,isCut:isCut,groups:groups,consumption:consumption,stepKey:stepKey,operationsFromPage:operationsFromPage,operationQuantitiesFromPage:operationQuantitiesFromPage};
});
