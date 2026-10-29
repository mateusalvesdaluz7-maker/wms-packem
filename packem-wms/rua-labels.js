(function(root){
  'use strict';

  function key(value){return String(value==null?'':value).trim().toUpperCase();}
  function address(space){return key(space.s)+'-'+space.p+'-'+space.l;}

  function sameAmount(a,b){return Math.abs(Number(a)-Number(b))<0.000001;}

  /* Uma etiqueta por vaga. O item e o peso impressos vêm sempre do mapa. */
  function collect(spaces,locations,etiquetas,bobinas,street,level){
    var slots=(Array.isArray(spaces)?spaces:[]).filter(function(space){
      return space&&key(space.w)==='70'&&key(space.s)===key(street)
        &&String(space.l)===String(level)&&space.src!=='__WMS_SLOT_DISABLED__'
        &&space.o&&key(space.pr)&&Number(space.q)>0;
    }).sort(function(a,b){return Number(a.p)-Number(b.p)||address(a).localeCompare(address(b));});
    var byAddress={};
    Object.keys(locations||{}).sort().forEach(function(id){
      var addr=key(locations[id]);(byAddress[addr]||(byAddress[addr]=[])).push(id);
    });
    var labels=slots.map(function(space){
      var addr=address(space),product=key(space.pr),qty=Number(space.q);
      var matches=(byAddress[addr]||[]).filter(function(id){
        var saved=(etiquetas||{})[id],bobbin=(bobinas||{})[id];
        if(!saved&&!bobbin)return false;
        var catalogProduct=key((saved&&saved.cProd)||(bobbin&&bobbin.pr));
        var amount=bobbin&&bobbin.rem!=null&&bobbin.rem!==''?Number(bobbin.rem)
          :Number((saved&&saved.kg)||(bobbin&&bobbin.pl));
        return catalogProduct===product&&amount>0&&sameAmount(amount,qty);
      });
      var id=matches.length===1?matches[0]:'',saved=id&&(etiquetas||{})[id],bobbin=id&&(bobinas||{})[id];
      return {id:id,cProd:product,kg:qty,uCom:space.u||(saved&&saved.uCom)||'KG',addr:addr,
        xProd:(saved&&saved.xProd)||(bobbin&&bobbin.desc)||'',qrPayload:id||product+'$'+String(qty)};
    });
    return {labels:labels,missing:[],slots:slots.length};
  }

  root.PackemRuaLabels={collect:collect};
  if(typeof module!=='undefined'&&module.exports)module.exports={collect:collect};
})(typeof window!=='undefined'?window:globalThis);
