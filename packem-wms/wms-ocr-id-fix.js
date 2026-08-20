/* Correção complementar do identificador industrial de 10 dígitos. */
(function(){
  var anterior=window.ocrLocalExtraiCampos;
  if(typeof anterior!=='function')return;

  function corrige(valor){
    return String(valor||'').toUpperCase()
      .replace(/[^0-9OQILZSGBA]/g,'')
      .replace(/[OQA]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2')
      .replace(/S/g,'5').replace(/G/g,'6').replace(/B/g,'8');
  }

  function encontra(texto){
    var linhas=String(texto||'').toUpperCase().split(/\r?\n/);
    var lista=[];
    linhas.forEach(function(linha,idx){
      var partes=linha.match(/[0-9OQILZSGBA](?:[\s.:-]*[0-9OQILZSGBA]){8,11}/g)||[];
      partes.forEach(function(parte){
        var id=corrige(parte),p=0;
        if(id.length!==10)return;
        if(/^2\d{9}$/.test(id))p+=8;
        if(/^26\d{8}$/.test(id))p+=6;
        if(/IDENT|BOBINA|NUMERO|N[°º]/.test(linha))p+=3;
        if(corrige(linha)===id)p+=2;
        lista.push({id:id,p:p,idx:idx});
      });
    });
    var unido=linhas.join(' ').replace(/(?<=[0-9OQILZSGBA])[\s.:-]+(?=[0-9OQILZSGBA])/g,'');
    (unido.match(/[0-9OQILZSGBA]{10}/g)||[]).forEach(function(parte){
      var id=corrige(parte);
      lista.push({id:id,p:/^26/.test(id)?12:/^2/.test(id)?8:0,idx:999});
    });
    lista.sort(function(a,b){return b.p-a.p||a.idx-b.idx;});
    return lista.length&&lista[0].p>=8?lista[0].id:'';
  }

  window.ocrLocalExtraiCampos=function(texto){
    var dados=anterior(texto)||{};
    var atual=String(dados.identificador_bobina||'');
    if(!/^\d{10}$/.test(atual)){
      var id=encontra(texto);
      if(id)dados.identificador_bobina=id;
    }
    return dados;
  };
  ocrLocalExtraiCampos=window.ocrLocalExtraiCampos;
})();

/* Uma nova foto completa a leitura anterior do mesmo item; campos corretos não somem. */
(function(){
  var mostrarAnterior=window.showEtiquetaOcr;
  if(typeof mostrarAnterior==='function'){
    var memoria=window._ocrEtiquetaMemoria||(window._ocrEtiquetaMemoria={});
    function bom(v,tipo){
      v=String(v||'');
      if(tipo==='id')return /^\d{10}$/.test(v);
      if(tipo==='bobina')return /^\d{2,3}\s*x\s*\d{2,3}$/i.test(v);
      return /^\d{2,5}(?:[.,]\d{1,2})?$/.test(v)&&Number(v.replace(',','.'))>0;
    }
    window.showEtiquetaOcr=function(data,targetId){
      var chave=targetId||'etiquetaOcrResult',ant=memoria[chave]||{},novo=data||{};
      var junto={
        identificador_bobina:bom(novo.identificador_bobina,'id')?novo.identificador_bobina:(ant.identificador_bobina||novo.identificador_bobina),
        bobina:bom(novo.bobina,'bobina')?novo.bobina:(ant.bobina||novo.bobina),
        peso_bruto_kg:bom(novo.peso_bruto_kg,'peso')?novo.peso_bruto_kg:(ant.peso_bruto_kg||novo.peso_bruto_kg),
        peso_liquido_kg:bom(novo.peso_liquido_kg,'peso')?novo.peso_liquido_kg:(ant.peso_liquido_kg||novo.peso_liquido_kg)
      };
      memoria[chave]=junto;
      mostrarAnterior(junto,targetId);
      var box=document.getElementById(chave);
      if(box){
        var n=(bom(junto.identificador_bobina,'id')?1:0)+(bom(junto.bobina,'bobina')?1:0)+(bom(junto.peso_bruto_kg,'peso')?1:0)+(bom(junto.peso_liquido_kg,'peso')?1:0);
        var p=box.querySelector('p');
        if(p)p.textContent=n+'/4 campos reconhecidos. Se faltar algum, tire outra foto: os dados corretos já lidos serão mantidos.';
      }
    };
    showEtiquetaOcr=window.showEtiquetaOcr;
  }
})();

/* QR de estoque pode trazer JSON, texto ou vários campos. Procura a etiqueta real
   e entrega a baixa somente ao produto exatamente igual ao item solicitado. */
(function(){
  var estoqueAnterior=window.expStockTag;
  if(typeof estoqueAnterior!=='function')return;
  window.expStockTag=function(valor){
    var achou=estoqueAnterior(valor);
    if(achou)return achou;
    var bruto=String(valor||''),candidatos=[];
    try{
      var obj=JSON.parse(bruto);
      (function anda(v){
        if(v==null)return;
        if(typeof v==='object'){Object.keys(v).forEach(function(k){anda(v[k]);});return;}
        candidatos.push(String(v));
      })(obj);
    }catch(e){}
    var tag=(typeof extractTag==='function'?extractTag(bruto):'');
    if(tag)candidatos.unshift(tag);
    (bruto.match(/[A-Z0-9_-]{6,40}/gi)||[]).forEach(function(v){candidatos.push(v);});
    var vistos={};
    for(var i=0;i<candidatos.length;i++){
      var c=String(candidatos[i]||'').trim(),n=(typeof norm==='function'?norm(c):c);
      if(!n||vistos[n])continue;vistos[n]=1;
      achou=estoqueAnterior(c);
      if(achou)return achou;
    }
    return null;
  };
  expStockTag=window.expStockTag;
})();