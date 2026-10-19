(function(){
  'use strict';
  var field=document.getElementById('previewEtiqueta');
  // Esta prévia não carrega wms-app.js nem possui acesso às APIs de estoque.
  window.packemNfcContext=function(id){return id===field.id?{preview:true,input:field}:null;};
  window.applyPackemNfcScan=function(id,code,options,context){
    if(id!==field.id||!context||context.input!==field)return false;
    field.value=code;
    document.getElementById('previewResult').textContent='Prévia: código recebido '+code+'. Nenhuma movimentação de estoque executada.';
    return true;
  };
  window.PackemNFC.attach(field.id,{title:'etiqueta do material'});
})();
