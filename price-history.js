(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SnackPrices=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const labels={regular:'일반가',wow:'와우회원가',coupon:'쿠폰가',wow_coupon:'와우·쿠폰가'};
  function dayKey(value){const n=new Date(value).getTime();return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):null;}
  function dayNumber(day){return Date.parse(day+'T00:00:00Z')/DAY;}
  function recordDay(r){return r.checkedDate||dayKey(r.checkedAt);}
  function recordTime(r){return r.checkedAt?Date.parse(r.checkedAt):Date.parse(r.checkedDate+'T00:00:00+09:00');}
  function scope(r){return r.priceScope==='item'?'item':'total';}
  function amount(r){return r.price+(scope(r)==='item'?0:r.shippingFee);}
  function summarize(product,history,now=new Date()){
    const today=dayKey(now),start=dayNumber(today)-29;
    const matches=r=>r.productId===product.id&&r.trackingKey===product.trackingKey&&Number.isFinite(recordTime(r))&&recordDay(r)<=today&&recordTime(r)<=+now;
    const observations=(history.observations||[]).filter(r=>matches(r)&&Number.isSafeInteger(r.price)&&r.price>0&&(scope(r)==='item'?r.shippingFee===null:Number.isSafeInteger(r.shippingFee)&&r.shippingFee>=0)).sort((a,b)=>recordTime(a)-recordTime(b));
    const checks=(history.checks||[]).filter(matches).sort((a,b)=>recordTime(a)-recordTime(b));
    const latest=observations.at(-1)||null,lastCheck=checks.at(-1)||null;
    const daily=new Map();
    if(latest)for(const r of observations){const d=recordDay(r);if(r.conditionKey===latest.conditionKey&&r.basis===latest.basis&&scope(r)===scope(latest)&&dayNumber(d)>=start&&d<=today)daily.set(d,{...r,date:d,total:amount(r)});}
    const points=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const low=points.length?Math.min(...points.map(r=>r.total)):null;
    const average=points.length?Math.round(points.reduce((s,r)=>s+r.total,0)/points.length):null;
    const failed=!!(lastCheck&&lastCheck.status!=='ok'&&(!latest||recordTime(lastCheck)>=recordTime(latest)));
    const stale=!!latest&&recordDay(latest)!==today;
    const complete=points.length===30;
    const total=latest?amount(latest):product.price;
    const paused=!!product.trackingPaused;
    const priceScope=latest?scope(latest):'total';
    const atLow=priceScope==='total'&&!paused&&!failed&&!stale&&complete&&low!==null&&total===low;
    const previous=points.length>1&&dayNumber(points.at(-1).date)-dayNumber(points.at(-2).date)===1?points.at(-2):null;
    const change=previous?total-previous.total:null;
    let badge=paused?'구성 확인 필요':failed?({failed:'가격 확인 실패',out_of_stock:'품절 확인',configuration_mismatch:'구성 확인 필요'}[lastCheck.status]||'확인 필요'):!latest?'첫 가격 확인 대기':stale?'이전 확인 가격':atLow?'30일 확인 최저가':priceScope==='item'?`상품가 기록 · ${points.length}/30일`:complete?'30일 비교 가능':`기록 중 · ${points.length}/30일`;
    return {latest,lastCheck,points,low,average,total,complete,atLow,failed,stale,paused,badge,priceScope,change,days:points.length,today,startDate:new Date(start*DAY).toISOString().slice(0,10),conditionLabel:latest?(latest.conditionLabel||labels[latest.basis]||'확인 가격'):null,displayDifference:latest&&low!==null?total-low:null};
  }
  function chart(points,today){
    if(!points.length)return null;
    const width=270,height=92,left=10,right=260,top=12,bottom=77;
    const end=dayNumber(today),start=end-29,values=points.map(p=>p.total),min=Math.min(...values),max=Math.max(...values);
    const margin=Math.max((max-min)*.15,min*.015,1),lo=min-margin,hi=max+margin;
    const mapped=points.map(p=>({date:p.date,value:p.total,x:left+(dayNumber(p.date)-start)/29*(right-left),y:bottom-(p.total-lo)/(hi-lo)*(bottom-top)}));
    const segments=[];let current=[];
    mapped.forEach((p,i)=>{if(i&&dayNumber(p.date)-dayNumber(mapped[i-1].date)>1){if(current.length)segments.push(current);current=[];}current.push(p);});if(current.length)segments.push(current);
    return {width,height,points:mapped,segments,min,max};
  }
  return {dayKey,recordDay,recordTime,summarize,chart};
});
