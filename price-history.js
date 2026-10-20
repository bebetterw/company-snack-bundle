(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SnackPrices=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const labels={regular:'일반가',wow:'와우회원가',coupon:'쿠폰가',wow_coupon:'와우·쿠폰가'};
  function dayKey(value){const n=new Date(value).getTime();return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):null;}
  function dayNumber(day){return Date.parse(day+'T00:00:00Z')/DAY;}
  function summarize(product,history,now=new Date()){
    const today=dayKey(now),start=dayNumber(today)-29;
    const matches=r=>r.productId===product.id&&r.trackingKey===product.trackingKey&&r.checkedAt&&new Date(r.checkedAt)<=now;
    const observations=(history.observations||[]).filter(r=>matches(r)&&Number.isSafeInteger(r.price)&&r.price>0&&Number.isSafeInteger(r.shippingFee)&&r.shippingFee>=0).sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
    const checks=(history.checks||[]).filter(matches).sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
    const latest=observations.at(-1)||null,lastCheck=checks.at(-1)||null;
    const daily=new Map();
    if(latest)for(const r of observations){const d=dayKey(r.checkedAt);if(r.conditionKey===latest.conditionKey&&r.basis===latest.basis&&dayNumber(d)>=start&&d<=today)daily.set(d,{...r,date:d,total:r.price+r.shippingFee});}
    const points=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const low=points.length?Math.min(...points.map(r=>r.total)):null;
    const average=points.length?Math.round(points.reduce((s,r)=>s+r.total,0)/points.length):null;
    const failed=!!(lastCheck&&lastCheck.status!=='ok'&&(!latest||Date.parse(lastCheck.checkedAt)>=Date.parse(latest.checkedAt)));
    const stale=!!latest&&dayKey(latest.checkedAt)!==today;
    const complete=points.length===30;
    const total=latest?latest.price+latest.shippingFee:product.price;
    const paused=!!product.trackingPaused;
    const atLow=!paused&&!failed&&!stale&&complete&&low!==null&&total===low;
    let badge=paused?'구성 확인 필요':failed?({failed:'가격 확인 실패',out_of_stock:'품절 확인',configuration_mismatch:'구성 확인 필요'}[lastCheck.status]||'확인 필요'):!latest?'첫 가격 확인 대기':stale?'이전 확인 가격':atLow?'30일 확인 최저가':complete?'30일 비교 가능':`기록 중 · ${points.length}/30일`;
    return {latest,lastCheck,points,low,average,total,complete,atLow,failed,stale,paused,badge,days:points.length,today,startDate:new Date(start*DAY).toISOString().slice(0,10),conditionLabel:latest?(latest.conditionLabel||labels[latest.basis]||'확인 가격'):null,displayDifference:latest&&low!==null?total-low:null};
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
  return {dayKey,summarize,chart};
});
