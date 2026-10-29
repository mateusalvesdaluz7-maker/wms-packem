(function(root){
  'use strict';

  function key(value){return String(value==null?'':value).trim().toUpperCase();}
  function address(space){return key(space.s)+'-'+space.p+'-'+space.l;}

  /* Prepara somente etiquetas já vinculadas ao estoque. Imprimir nunca cria outro ID. */
  function collect(spaces,locations,etiquetas,bobinas,street,level){
    var slots=(Array.isArray(spaces)?spaces:[]).filter(function(space){
      return space&&key(space.w)==='70'&&key(space.s)===key(street)
        &&(String(level)==='todos'||String(space.l)===String(level))
        &&space.src!=='__WMS_SLOT_DISABLED__'&&space.o&&space.pr&&Number(space.q)>0;
    }).sort(function(a,b){return Number(a.l)-Number(b.l)||Number(a.p)-Number(b.p)||address(a).localeCompare(address(b));});
    var byAddress={},found={},missing=[],labels=[];
    slots.forEach(function(space){byAddress[address(space)]=space;found[address(space)]=0;});
    Object.keys(locations||{}).sort().forEach(function(id){
      var addr=key(locations[id]),space=byAddress[addr];
      if(!space)return;
      var saved=(etiquetas||{})[id],bobbin=(bobinas||{})[id];
      if(!saved&&!bobbin){missing.push({addr:addr,id:id,reason:'Etiqueta sem cadastro'});return;}
      var product=key((saved&&saved.cProd)||(bobbin&&bobbin.pr)||space.pr);
      if(product!==key(space.pr)){missing.push({addr:addr,id:id,reason:'Produto diferente do registrado na vaga'});return;}
      var hasRemaining=!!(bobbin&&bobbin.rem!=null&&bobbin.rem!=='');
      var remaining=Number(bobbin&&bobbin.rem),original=Number((saved&&saved.kg)||(bobbin&&bobbin.pl)||0);
      var qty=hasRemaining?remaining:original;
      if(!(qty>0)){missing.push({addr:addr,id:id,reason:'Peso ou quantidade ausente'});return;}
      labels.push(Object.assign({},saved||{}, {
        id:id,cProd:product,xProd:(saved&&saved.xProd)||(bobbin&&bobbin.desc)||'',
        kg:qty,uCom:(saved&&saved.uCom)||space.u||'KG',addr:addr
      }));
      found[addr]++;
    });
    slots.forEach(function(space){
      var addr=address(space);
      if(!found[addr])missing.push({addr:addr,reason:'Vaga ocupada sem etiqueta pronta para imprimir'});
    });
    var position={};slots.forEach(function(space,index){position[address(space)]=index;});
    labels.sort(function(a,b){return position[a.addr]-position[b.addr]||a.id.localeCompare(b.id);});
    return {labels:labels,missing:missing,slots:slots.length};
  }

  root.PackemRuaLabels={collect:collect};
  if(typeof module!=='undefined'&&module.exports)module.exports={collect:collect};
})(typeof window!=='undefined'?window:globalThis);
