(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CutFlowDashboardCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function stamp(value){
    var time=Date.parse(value||'');
    return Number.isFinite(time)&&time>0?time:null;
  }
  function percent(value){return Math.max(0,Math.min(100,Number(value)||0));}
  function minutes(start,end){return start!==null&&end!==null&&end>=start?Math.round((end-start)/60000):null;}
  function duration(value){
    if(value===null||!Number.isFinite(value)||value<0)return '—';
    var total=Math.round(value),days=Math.floor(total/1440),hours=Math.floor(total%1440/60),mins=total%60;
    if(days)return days+'d '+hours+'h';
    if(hours)return hours+'h '+(mins?mins+'min':'');
    return mins+'min';
  }
  function first(values){return values.length?Math.min.apply(null,values):null;}
  function last(values){return values.length?Math.max.apply(null,values):null;}
  function requestTiming(requests,complete,now){
    var active=(Array.isArray(requests)?requests:[]).filter(function(request){return request&&String(request.status||'').toLowerCase()!=='cancelado';});
    var starts=[],ends=[];
    active.forEach(function(request){
      var start=stamp(request.ts_inicio_separacao);
      if(start===null){
        var scans=(request.itens||request.items||[]).flatMap(function(item){return Array.isArray(item.fifo_etiquetas)?item.fifo_etiquetas:[];}).map(function(scan){return stamp(scan&&scan.at);}).filter(function(time){return time!==null;});
        start=first(scans);
      }
      if(start!==null)starts.push(start);
      var end=stamp(request.ts_fim_separacao)||stamp(request.ts_entrega);
      if(end!==null)ends.push(end);
    });
    var startedAt=first(starts),finishedAt=complete&&ends.length===active.length?last(ends):null;
    return {startedAt:startedAt,finishedAt:finishedAt,elapsedMinutes:minutes(startedAt,finishedAt===null?now:finishedAt),completedMinutes:minutes(startedAt,finishedAt),paused:active.some(function(request){return String(request.status||'').toLowerCase()==='pausado';})};
  }
  function expeditionTiming(record,complete,now){
    if(!record||record._del||record.cancelado)return {startedAt:null,finishedAt:null,elapsedMinutes:null,completedMinutes:null};
    var audits=Array.isArray(record._audit)?record._audit:[],starts=[],ends=[];
    audits.forEach(function(event){
      var time=stamp(event&&event.at),action=String(event&&event.acao||'');
      if(time===null)return;
      if(/^(bip_separacao|bip_conferencia|bip_quantidade|bip_estoque_romaneio)$/.test(action))starts.push(time);
      if(/^(bip_conferencia|status_manual)$/.test(action))ends.push(time);
    });
    var startedAt=first(starts),finishedAt=complete?last(ends):null;
    return {startedAt:startedAt,finishedAt:finishedAt,elapsedMinutes:minutes(startedAt,finishedAt===null?now:finishedAt),completedMinutes:minutes(startedAt,finishedAt)};
  }
  function estimateRemaining(progress,timing){
    var value=percent(progress),elapsed=timing&&timing.elapsedMinutes;
    if(value>=100)return 0;
    if(timing&&timing.paused)return null;
    if(value<5||elapsed===null||elapsed<5)return null;
    var remaining=Math.ceil(elapsed*(100-value)/value);
    return remaining>0&&remaining<=43200?remaining:null;
  }
  function flowStageTimes(row,item,at){
    row=row||{};item=item||{};
    var now=stamp(at)||Date.now(),op=row.op||{},separation=row.separation||{},expedition=row.expedition||{},record=expedition.record||{},quantities=expedition.quantities||{};
    var requests=(Array.isArray(separation.requests)?separation.requests:[]).filter(function(request){return request&&String(request.status||'').toLowerCase()!=='cancelado';});
    var requestStarts=requests.map(function(request){return stamp(request.created_date)||stamp(request.createdAt);}).filter(function(time){return time!==null;});
    var requestStart=first(requestStarts);if(requestStart===null&&requests.length)requestStart=stamp(op.createdAt);
    var releases=requests.map(function(request){
      var release=Array.isArray(request.historico)?first(request.historico.filter(function(event){return event&&/Corte escolheu materiais/i.test(String(event.acao||''));}).map(function(event){return stamp(event.ts);}).filter(function(time){return time!==null;})):null;
      if(release===null)release=stamp(request.liberada_em);
      if(release===null&&!request.selecao_corte_requerida)release=stamp(request.created_date)||stamp(request.createdAt)||stamp(op.createdAt);
      return release;
    }).filter(function(time){return time!==null;});
    var requestReady=releases.length>0||requests.some(function(request){return !!request.liberada_logistica||(request.itens||[]).some(function(line){return !!line.liberado_logistica;});});
    var requestFinish=requestReady?first(releases):null;
    var sepTime=item.separation||{},sepStarted=sepTime.startedAt==null?null:sepTime.startedAt;
    var audits=Array.isArray(record._audit)?record._audit:[],productTimes=[],conferenceTimes=[];
    audits.forEach(function(event){
      if(!event)return;
      var action=String(event.acao||''),time=stamp(event.at);
      if(time===null)return;
      if(action==='bip_separacao'||action==='bip_quantidade')productTimes.push(time);
      else if(action==='bip_conferencia')conferenceTimes.push(time);
    });
    function auditClock(times,progress){
      var startedAt=first(times),finishedAt=percent(progress)>=100?last(times):null;
      return {startedAt:startedAt,finishedAt:finishedAt,elapsedMinutes:minutes(startedAt,finishedAt===null?now:finishedAt)};
    }
    var productScan=auditClock(productTimes,quantities.scannedPercent),expeditionCheck=auditClock(conferenceTimes,item.expPercent);
    return {
      pcp:{elapsedMinutes:0,immediate:true},
      request:{ready:requestReady,startedAt:requestStart,finishedAt:requestFinish,elapsedMinutes:minutes(requestStart,requestReady?requestFinish:now)},
      separation:{startedAt:sepStarted,finishedAt:sepTime.finishedAt,elapsedMinutes:sepTime.elapsedMinutes,waitingMinutes:sepStarted===null?minutes(requestFinish,now):null,paused:!!sepTime.paused},
      production:{elapsedMinutes:null},
      productScan:productScan,
      expedition:expeditionCheck
    };
  }
  function summarize(rows,at){
    var now=stamp(at)||Date.now(),items=(Array.isArray(rows)?rows:[]).map(function(row){
      var separation=row.separation||{},expedition=row.expedition||{},reqs=separation.requests||[];
      var sepLinked=!!separation.linked&&reqs.some(function(request){return request&&String(request.status||'').toLowerCase()!=='cancelado';});
      var expLinked=!!expedition.record&&!expedition.record._del&&!expedition.record.cancelado;
      var sepPercent=percent(separation.percent),expPercent=percent(expedition.percent);
      var sepTime=requestTiming(reqs,sepLinked&&sepPercent>=100,now),expTime=expeditionTiming(expedition.record,expLinked&&expPercent>=100,now);
      var overallPercent=percent(row.overallPercent),opStart=stamp(row.op&&row.op.createdAt),fullyDone=sepLinked&&expLinked&&sepPercent>=100&&expPercent>=100,opDone=fullyDone?expTime.finishedAt:null;
      var opElapsedMinutes=minutes(opStart,opDone===null?now:opDone);
      return {op:row.op,sepLinked:sepLinked,expLinked:expLinked,sepPercent:sepPercent,expPercent:expPercent,
        separation:sepTime,expedition:expTime,sepRemaining:sepLinked?estimateRemaining(sepPercent,sepTime):null,
        expRemaining:expLinked?estimateRemaining(expPercent,expTime):null,
        overallPercent:overallPercent,opElapsedMinutes:opElapsedMinutes,opCompletedMinutes:minutes(opStart,opDone),
        opRemaining:fullyDone?0:opStart!==null?estimateRemaining(overallPercent,{elapsedMinutes:opElapsedMinutes}):null};
    });
    function stage(key){
      var linked=items.filter(function(item){return item[key+'Linked'];}),times=linked.map(function(item){return item[key==='sep'?'separation':'expedition'].completedMinutes;}).filter(function(value){return value!==null;});
      return {total:linked.length,complete:linked.filter(function(item){return item[key+'Percent']>=100;}).length,
        percent:linked.length?Math.round(linked.reduce(function(sum,item){return sum+item[key+'Percent'];},0)/linked.length):null,
        averageMinutes:times.length?Math.round(times.reduce(function(sum,value){return sum+value;},0)/times.length):null,samples:times.length};
    }
    var completeTimes=items.map(function(item){return item.opCompletedMinutes;}).filter(function(value){return value!==null;});
    return {items:items,separation:stage('sep'),expedition:stage('exp'),completedOps:completeTimes.length,
      averageOpMinutes:completeTimes.length?Math.round(completeTimes.reduce(function(sum,value){return sum+value;},0)/completeTimes.length):null};
  }
  return {summarize:summarize,duration:duration,estimateRemaining:estimateRemaining,requestTiming:requestTiming,expeditionTiming:expeditionTiming,flowStageTimes:flowStageTimes};
});
