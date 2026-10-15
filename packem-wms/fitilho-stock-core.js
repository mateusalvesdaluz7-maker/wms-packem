(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.FitilhoStockCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function text(value){return String(value==null?'':value).trim();}
  function code(value){return text(value).toUpperCase();}
  function weight(value){var n=Number(String(value==null?'':value).replace(',','.'));if(!Number.isFinite(n)||n<=0)throw new Error('Informe um peso em kg maior que zero.');return Math.round(n*1000)/1000;}
  function sum(rows){return Math.round(rows.reduce(function(total,row){return total+Number(row.kg||0);},0)*1000)/1000;}
  var AREAS=['pet-24','pp-21'];
  function area(value){var result=text(value).toLowerCase();if(AREAS.indexOf(result)<0)throw new Error('Escolha o estoque PET - 24 ou PP - 21.');return result;}
  function initial(){return {version:3,bobbins:[],requests:[],movements:[]};}
  function normalize(state){
    if(!state||![1,2,3].includes(state.version))return initial();
    return {version:3,bobbins:Array.isArray(state.bobbins)?state.bobbins.map(function(row){return Object.assign({area:'',materialType:'fitilho'},row);}):[],requests:Array.isArray(state.requests)?state.requests.map(function(row){return Object.assign({area:''},row);}):[],movements:Array.isArray(state.movements)?state.movements:[]};
  }
  function copy(state){return JSON.parse(JSON.stringify(normalize(state)));}
  function move(state,type,bobbin,data,amount){
    state.movements.unshift({id:code(data.id)||'MOV-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,8).toUpperCase(),type:type,label:bobbin.label,area:bobbin.area,productCode:bobbin.productCode,kg:amount,machine:code(data.machine||bobbin.machineId),destination:text(data.destination),op:code(data.op||bobbin.machineOp),requestId:code(data.sourceRequestId||bobbin.sourceRequestId),itemId:code(data.sourceItemId||bobbin.sourceItemId),at:text(data.at)||new Date().toISOString(),by:text(data.by)});
    return state;
  }
  function receive(state,data){
    var next=copy(state),label=code(data.label),productCode=code(data.productCode),lot=code(data.lot),kg=weight(data.kg),stockArea=area(data.area),materialType=text(data.materialType||'fitilho');
    if(!label||!productCode)throw new Error('Bipe a etiqueta e informe o código do material.');
    if(['materia-prima','fitilho'].indexOf(materialType)<0)throw new Error('Escolha matéria-prima ou fitilho produzido.');
    if(next.bobbins.some(function(row){return row.label===label;}))throw new Error('Esta etiqueta já foi registrada no estoque da Extrusora.');
    var bobbin={label:label,area:stockArea,materialType:materialType,productCode:productCode,description:text(data.description),lot:lot,kg:kg,sourceKg:kg,sourceRequestId:code(data.sourceRequestId),sourceItemId:code(data.sourceItemId),op:code(data.op),machine:code(data.machine),receivedAt:text(data.at)||new Date().toISOString(),receivedBy:text(data.by),status:'stock',requestId:null,dispatchedAt:null,dispatchedBy:null};
    next.bobbins.unshift(bobbin);
    return move(next,'entrada',bobbin,data,kg);
  }
  function receiveFromRequest(state,data){
    var next=copy(state),label=code(data.label),stockArea=area(data.area),requestId=code(data.requestId),itemId=code(data.itemId),productCode=code(data.productCode);
    if(!label||!requestId||!itemId||!productCode)throw new Error('Requisição, item, código e etiqueta são obrigatórios para a entrada.');
    if(code(data.unit)!=='KG')throw new Error('A entrada automática da Extrusora exige quantidade em KG.');
    var existing=next.bobbins.find(function(row){return row.label===label;});
    if(existing){
      if(existing.area===stockArea&&existing.sourceRequestId===requestId&&existing.sourceItemId===itemId&&existing.productCode===productCode&&existing.materialType==='materia-prima'&&existing.sourceKg===weight(data.kg))return next;
      throw new Error('Etiqueta já está registrada em outro lançamento ou estoque.');
    }
    return receive(next,{label:label,area:stockArea,materialType:'materia-prima',productCode:productCode,description:data.description,lot:data.lot,kg:data.kg,by:data.by,at:data.at,sourceRequestId:requestId,sourceItemId:itemId});
  }
  function requestDelivery(requests,label,stockArea){
    var scanned=code(label),selected=area(stockArea),matches=[];
    if(!scanned)return null;
    (Array.isArray(requests)?requests:[]).forEach(function(request){
      if(!request||['cancelado','cancelada'].indexOf(text(request.status).toLowerCase())>=0)return;
      (Array.isArray(request.itens)?request.itens:[]).forEach(function(item){
        (Array.isArray(item.fifo_etiquetas)?item.fifo_etiquetas:[]).forEach(function(entry){
          if(!entry||code(entry.et)!==scanned||!entry.extrusora_area)return;
          matches.push({requestId:code(request.id),itemId:code(item.id),label:scanned,area:text(entry.extrusora_area),productCode:code(item.codigo||item.cod),description:text(item.material||item.descricao),kg:entry.q,unit:code(item.unidade||item.un),at:text(entry.at)});
        });
      });
    });
    if(matches.length>1)throw new Error('Etiqueta vinculada a mais de uma requisição. Confira o histórico antes de receber.');
    if(matches.length&&matches[0].area!==selected)throw new Error('Esta etiqueta foi requisitada para a Extrusora '+(matches[0].area==='pp-21'?'PP - 21':'PET - 24')+'.');
    return matches[0]||null;
  }
  function request(state,data){
    var next=copy(state),id=code(data.id),tearOp=code(data.tearOp),productCode=code(data.productCode),usage=text(data.usage),requestedKg=weight(data.kg),stockArea=area(data.area);
    if(!id||next.requests.some(function(row){return row.id===id;}))throw new Error('Identificador da requisição ausente ou repetido.');
    if(!tearOp||!productCode)throw new Error('Informe a OP do Tear e o código do fitilho.');
    if(['warp','weft','both'].indexOf(usage)<0)throw new Error('Escolha urdume, trama ou ambos.');
    next.requests.unshift({id:id,area:stockArea,tearOp:tearOp,productCode:productCode,usage:usage,requestedKg:requestedKg,createdAt:text(data.at)||new Date().toISOString(),createdBy:text(data.by),deliveries:[]});
    return next;
  }
  function requestProgress(state,id){
    var current=normalize(state),row=current.requests.find(function(item){return item.id===code(id);});
    if(!row)return null;
    var deliveredKg=sum(row.deliveries||[]),remainingKg=Math.max(0,Math.round((row.requestedKg-deliveredKg)*1000)/1000);
    return {request:row,deliveredKg:deliveredKg,remainingKg:remainingKg,excessKg:Math.max(0,Math.round((deliveredKg-row.requestedKg)*1000)/1000),percent:Math.min(100,Math.round(deliveredKg/row.requestedKg*100)),complete:remainingKg<=0.001};
  }
  function dispatch(state,requestId,data){
    var next=copy(state),row=next.requests.find(function(item){return item.id===code(requestId);}),label=code(data.label);
    if(!row)throw new Error('Requisição do Tear não encontrada.');
    if(!label)throw new Error('Bipe a etiqueta da bobina de fitilho.');
    var bobbin=next.bobbins.find(function(item){return item.label===label;});
    if(!bobbin)throw new Error('Etiqueta não registrada no estoque da Extrusora.');
    if(bobbin.status!=='stock')throw new Error('Esta bobina já saiu do estoque da Extrusora.');
    if(bobbin.materialType!=='fitilho')throw new Error('O Tear requisita fitilho produzido; esta etiqueta é matéria-prima.');
    if(!row.area||bobbin.area!==row.area)throw new Error('A bobina está em outro estoque. Confira PET - 24 ou PP - 21 na requisição.');
    if(bobbin.productCode!==row.productCode)throw new Error('O código da bobina não corresponde ao fitilho solicitado.');
    if(requestProgress(next,row.id).complete)throw new Error('Esta requisição já foi atendida.');
    var at=text(data.at)||new Date().toISOString(),by=text(data.by);
    bobbin.status='consumed';bobbin.requestId=row.id;bobbin.dispatchedAt=at;bobbin.dispatchedBy=by;
    row.deliveries.push({label:label,area:bobbin.area,productCode:bobbin.productCode,lot:bobbin.lot,kg:bobbin.kg,at:at,by:by,tearOp:row.tearOp,usage:row.usage});
    return move(next,'saida-tear',bobbin,Object.assign({},data,{op:row.tearOp,destination:'Tear',at:at}),bobbin.kg);
  }
  function stockBobbin(next,data){
    var label=code(data.label),stockArea=area(data.area),bobbin=next.bobbins.find(function(item){return item.label===label;});
    if(!label)throw new Error('Bipe a etiqueta do material.');
    if(!bobbin)throw new Error('Etiqueta não registrada no estoque da Extrusora.');
    if(bobbin.area!==stockArea)throw new Error('Etiqueta está em outro estoque. Confira PET - 24 ou PP - 21.');
    if(bobbin.status!=='stock')throw new Error('Esta etiqueta já saiu do estoque da Extrusora.');
    return bobbin;
  }
  function sendToMachine(state,data){
    var next=copy(state),bobbin=stockBobbin(next,data),machine=code(data.machine);
    if(!machine)throw new Error('Informe a máquina de destino.');
    if(bobbin.materialType!=='materia-prima')throw new Error('A máquina da Extrusora recebe matéria-prima; esta etiqueta é fitilho produzido.');
    bobbin.status='machine';bobbin.machineId=machine;bobbin.machineOp=code(data.op);bobbin.machineAt=text(data.at)||new Date().toISOString();bobbin.machineBy=text(data.by);bobbin.machineRemainingKg=bobbin.kg;
    return move(next,'saida-maquina',bobbin,data,bobbin.kg);
  }
  function exitStock(state,data){
    var next=copy(state),bobbin=stockBobbin(next,data),destination=text(data.destination);
    if(!destination)throw new Error('Informe o destino da saída.');
    bobbin.status='out';bobbin.destination=destination;bobbin.dispatchedAt=text(data.at)||new Date().toISOString();bobbin.dispatchedBy=text(data.by);
    return move(next,'saida',bobbin,data,bobbin.kg);
  }
  function machineBobbin(next,data){
    var label=code(data.label),stockArea=area(data.area),bobbin=next.bobbins.find(function(item){return item.label===label;});
    if(!label||!bobbin||bobbin.area!==stockArea||bobbin.status!=='machine')throw new Error('Etiqueta não está em uma máquina desta Extrusora.');
    if(data.machine&&code(data.machine)!==bobbin.machineId)throw new Error('Etiqueta está em outra máquina. Confira o destino antes de apontar.');
    return bobbin;
  }
  function consumeMachine(state,data){
    var next=copy(state),bobbin=machineBobbin(next,data),available=Number(bobbin.machineRemainingKg)||0,amount=data.kg===undefined||data.kg===''?available:weight(data.kg);
    if(amount>available+0.0001)throw new Error('Consumo maior que o peso disponível na máquina.');
    bobbin.machineRemainingKg=Math.max(0,Math.round((available-amount)*1000)/1000);
    if(bobbin.machineRemainingKg===0){bobbin.status='used';bobbin.consumedAt=text(data.at)||new Date().toISOString();}
    return move(next,'consumo-maquina',bobbin,data,amount);
  }
  function returnFromMachine(state,data){
    var next=copy(state),bobbin=machineBobbin(next,data),remaining=Number(bobbin.machineRemainingKg)||0,from=bobbin.machineId;
    if(remaining<=0)throw new Error('Não há material para devolver ao estoque.');
    bobbin.status='stock';bobbin.kg=remaining;bobbin.machineId='';bobbin.machineOp='';bobbin.machineRemainingKg=0;bobbin.returnedAt=text(data.at)||new Date().toISOString();
    return move(next,'retorno-maquina',bobbin,Object.assign({},data,{machine:from}),remaining);
  }
  function machines(state,stockArea){
    var groups={};normalize(state).bobbins.filter(function(row){return row.status==='machine'&&(!stockArea||row.area===stockArea);}).forEach(function(row){var key=row.area+'|'+row.machineId,group=groups[key]||(groups[key]={area:row.area,machine:row.machineId,bobbins:[],kg:0});group.bobbins.push(row);group.kg+=Number(row.machineRemainingKg)||0;});
    return Object.keys(groups).sort().map(function(key){var group=groups[key];group.kg=Math.round(group.kg*1000)/1000;return group;});
  }
  function inventory(state,stockArea){
    var current=normalize(state),rows=stockArea===undefined?current.bobbins:current.bobbins.filter(function(row){return row.area===stockArea;}),available=rows.filter(function(row){return row.status==='stock';}),dispatched=rows.filter(function(row){return row.status!=='stock';}),byCode={};
    available.forEach(function(row){var item=byCode[row.productCode]||(byCode[row.productCode]={productCode:row.productCode,kg:0,bobbins:0});item.kg+=Number(row.kg)||0;item.bobbins++;});
    return {available:available,dispatched:dispatched,availableKg:sum(available),dispatchedKg:sum(dispatched),byCode:Object.keys(byCode).sort().map(function(key){var row=byCode[key];row.kg=Math.round(row.kg*1000)/1000;return row;})};
  }
  function assignArea(state,kind,id,stockArea){
    var next=copy(state),selected=area(stockArea),row;
    if(kind==='bobbin'){row=next.bobbins.find(function(item){return item.label===code(id);});if(!row||row.area||row.status!=='stock')throw new Error('Apenas bobinas antigas disponíveis podem ser classificadas.');row.area=selected;}
    else if(kind==='request'){row=next.requests.find(function(item){return item.id===code(id);});if(!row||row.area)throw new Error('A requisição já possui estoque de origem.');row.area=selected;(row.deliveries||[]).forEach(function(delivery){var bobbin=next.bobbins.find(function(item){return item.label===delivery.label;});if(bobbin&&!bobbin.area)bobbin.area=selected;delivery.area=selected;});}
    else throw new Error('Registro para classificação inválido.');
    return next;
  }
  return {initial:initial,normalize:normalize,receive:receive,receiveFromRequest:receiveFromRequest,requestDelivery:requestDelivery,request:request,dispatch:dispatch,requestProgress:requestProgress,inventory:inventory,assignArea:assignArea,sendToMachine:sendToMachine,exitStock:exitStock,consumeMachine:consumeMachine,returnFromMachine:returnFromMachine,machines:machines};
});
