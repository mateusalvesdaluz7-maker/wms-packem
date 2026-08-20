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