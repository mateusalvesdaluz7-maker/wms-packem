/* Etiqueta manual do rastreio -> mesmo ID no cadastro e na impressão NFC. */
(function(root){
  'use strict';
  function validate(fields){
    var code=String(fields.codigo||'').trim().toUpperCase(),quantity=String(fields.quantidade||'').trim().replace(',','.'),unit=String(fields.unidade||'').toUpperCase();
    if(!/^[A-Z0-9._/-]{1,32}$/.test(code))throw new Error('Informe um código de produto válido.');
    if(!/^\d{1,9}(?:\.\d{1,6})?$/.test(quantity)||Number(quantity)<=0||Number(quantity)>=1e9)throw new Error('Informe peso ou quantidade maior que zero, sem separador de milhar e com até seis casas decimais.');
    if(!['KG','MT','UN'].includes(unit))throw new Error('Confira a unidade no cadastro do produto.');
    var description=String(fields.descricao||'').trim(),lot=String(fields.lote||'').trim();
    if(description.length>300||lot.length>80)throw new Error('Descrição ou lote excede o tamanho permitido.');
    return {cProd:code,xProd:description,lote:lot,kg:Number(quantity),un:unit};
  }
  function Creator(options){this.options=options;this.created=null;this.busy=false;}
  Creator.prototype.run=async function(fields){
    if(this.busy)throw new Error('Aguarde a criação da etiqueta terminar.');
    if(!this.options.isActive())throw new Error('Abra NFC → Cadastrar tags com seu usuário.');
    this.busy=true;
    try{
      if(!this.created){
        var data=validate(fields),id=this.options.create({...data,_print:false,_deferSync:true});
        if(typeof id!=='string'||!/^[A-Za-z0-9._/-]{1,32}$/.test(id))throw new Error('A criação não retornou um ID. Confira o rastreio antes de repetir.');
        this.created={id:id,data:data,synced:false};
      }
      var draft=this.created;
      if(!draft.synced){
        if(await this.options.sync(draft.id)!==true)throw new Error('Etiqueta '+draft.id+' criada neste aparelho, mas ainda não sincronizada. Use Tentar novamente para enviar o mesmo ID.');
        draft.synced=true;
      }
      if(!this.options.isActive())throw new Error('A tela ou o usuário mudou. A etiqueta '+draft.id+' foi preservada no rastreio.');
      var selected=await this.options.select(draft.id);
      if(!this.options.isActive()||!selected||selected.tag.item!==draft.id||selected.tag.codigo!==draft.data.cProd||Number(selected.tag.quantidade)!==draft.data.kg||selected.tag.unidade!==draft.data.un)throw new Error('Confira código, quantidade e unidade da etiqueta '+draft.id+' antes de vincular o chip.');
      return draft;
    }finally{this.busy=false;}
  };
  if(typeof module==='object'&&module.exports){module.exports={validate:validate,Creator:Creator};return;}
  if(!root.WmsNfcPrepare||!root.WmsNfcWorkspace)return;
  var host=root.WmsNfcWorkspace.host('v-labels');if(!host)return;
  var panel=document.createElement('section');panel.className='panel';panel.dataset.nfcManual='1';panel.style.cssText='padding:18px;margin:12px 0;border:1px solid var(--line);border-radius:12px';
  var details=document.createElement('details'),title=document.createElement('summary');title.textContent='Criar etiqueta manual — igual ao rastreio';details.appendChild(title);panel.appendChild(details);
  var intro=document.createElement('p');intro.textContent='Informe os dados de uma bobina. O WMS cria o ID, prepara o cadastro NFC e permite imprimir ou reimprimir a mesma etiqueta na Zebra.';details.appendChild(intro);
  var grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px';details.appendChild(grid);
  var inputs={};
  function field(key,label,max){var wrapper=document.createElement('label');wrapper.className='fld';var caption=document.createElement('span');caption.className='lab';caption.textContent=label;wrapper.appendChild(caption);var input=document.createElement('input');input.className='input';input.id='packemNfcManual-'+key;input.maxLength=max;wrapper.appendChild(input);grid.appendChild(wrapper);inputs[key]=input;return input;}
  var code=field('codigo','Código do produto',32),description=field('descricao','Descrição',300),quantity=field('quantidade','Peso líquido / quantidade',16),unit=field('unidade','Unidade do cadastro',2),lot=field('lote','Lote / OP (opcional)',80);
  quantity.inputMode='decimal';quantity.placeholder='Ex.: 300,5';unit.readOnly=true;unit.value='KG';
  var unitHint=document.createElement('small');unitHint.textContent='A unidade vem do cadastro do produto (KG, MT ou UN). Crie uma etiqueta para cada bobina.';details.appendChild(unitHint);
  var controls=document.createElement('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:14px';details.appendChild(controls);
  function button(text){var node=document.createElement('button');node.type='button';node.className='gbtn';node.textContent=text;controls.appendChild(node);return node;}
  var create=button('Criar e preparar NFC'),print=button('Imprimir / reimprimir etiqueta'),next=button('Nova bobina');print.disabled=true;next.hidden=true;
  var status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='A etiqueta será selecionada automaticamente para vincular o chip.';details.appendChild(status);
  var owner='',controller=null,completed=false;
  function user(){return typeof session!=='undefined'&&session?session.u:'';}
  function active(){return !!owner&&owner===user()&&root.WmsNfcReader.makeLabelContext().isActive();}
  function readerBusy(){return [root.WmsNfcMobile,root.PackemWmsApp,root.WmsNfcDireto,root.PackemNfcIphone].some(function(reader){return reader&&reader.active();})||root.WmsNfcReader.bridgeActive();}
  function reset(){
    owner=user();completed=false;
    controller=new Creator({isActive:active,create:function(data){if(typeof root.nfMakeLabel!=='function')throw new Error('Geração de etiquetas indisponível. Atualize o WMS.');return root.nfMakeLabel(data);},sync:async function(id){if(typeof syncEtiqueta!=='function'||typeof ETQ==='undefined'||!ETQ[id])throw new Error('Etiqueta não encontrada no rastreio.');return syncEtiqueta(ETQ[id]);},select:root.WmsNfcPrepare.select});
    Object.values(inputs).forEach(function(input){input.disabled=false;input.value='';});unit.value='KG';create.disabled=false;create.textContent='Criar e preparar NFC';print.disabled=true;next.hidden=true;status.textContent='A etiqueta será selecionada automaticamente para vincular o chip.';
  }
  function paint(){
    var draft=controller.created;Object.values(inputs).forEach(function(input){input.disabled=controller.busy||!!draft;});
    create.disabled=controller.busy;create.textContent=controller.busy?'Criando / conferindo etiqueta…':completed?'Selecionar etiqueta para NFC':draft?'Tentar novamente':'Criar e preparar NFC';
    print.disabled=controller.busy||!completed;next.hidden=!draft;next.disabled=controller.busy;
  }
  function fillProduct(){var product=code.value.trim().toUpperCase();unit.value=typeof unitOf==='function'?unitOf(product):'KG';var found=typeof nfDescByCode==='function'?nfDescByCode(product):'';if(!description.value||description.dataset.auto==='1'){description.value=found||'';description.dataset.auto='1';}}
  code.addEventListener('input',fillProduct);description.addEventListener('input',function(){description.dataset.auto='0';});
  create.onclick=async function(){
    if(controller.busy)return;
    if(readerBusy()){status.textContent='Conclua ou cancele o cadastro NFC atual antes de criar outra etiqueta.';return;}
    var current=controller;
    try{fillProduct();var pending=current.run(Object.fromEntries(Object.entries(inputs).map(function(entry){return [entry[0],entry[1].value];})));paint();var draft=await pending;if(current!==controller||!active())return;completed=true;status.textContent='Etiqueta '+draft.id+' criada e sincronizada · '+draft.data.cProd+' · '+String(draft.data.kg).replace('.',',')+' '+draft.data.un+'. Imprima a etiqueta e use Cadastrar próxima tag no painel abaixo para vincular o chip.';}
    catch(error){if(current===controller)status.textContent=error.message;}
    finally{if(current===controller)paint();}
  };
  print.onclick=function(){
    if(!active()||!completed||!controller.created){status.textContent='Prepare a etiqueta antes de imprimir.';return;}
    var id=controller.created.id,printOwner=owner;
    function send(format){if(!active()||owner!==printOwner||!controller.created||controller.created.id!==id)return;var record=typeof ETQ!=='undefined'&&ETQ[id];if(!record||typeof printZebraRast!=='function'){status.textContent='Impressão indisponível. Consulte a etiqueta '+id+' no rastreio.';return;}root.printZebraRast([record],format.dim,format.orient);}
    if(typeof root.askLabelFormat==='function')root.askLabelFormat('Etiqueta manual NFC',send);else status.textContent='Seleção de formato indisponível. Atualize o WMS.';
  };
  next.onclick=function(){if(readerBusy()){status.textContent='Conclua ou cancele o cadastro NFC atual antes de criar outra etiqueta.';return;}root.WmsNfcPrepare.clear();reset();code.focus();};
  host.insertBefore(panel,host.firstChild);reset();setInterval(function(){if(owner!==user())reset();},1000);
})(typeof window!=='undefined'?window:globalThis);
