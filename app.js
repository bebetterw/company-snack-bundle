let products = [], history = {schemaVersion:1,observations:[],checks:[]}, historyUnavailable = false;
let category = '전체', onlySaved = false, onlyLow = false, saved;
try { saved = new Set(JSON.parse(localStorage.getItem('office-snack-saved') || '[]')); } catch { saved = new Set(); }
let timer;
const money = n => n.toLocaleString('ko-KR');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateTime = value => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const snapshot = p => SnackPrices.summarize(p, history);
function toast(text) {
  const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(timer); timer = setTimeout(() => el.classList.remove('show'), 2200);
}
function graphHtml(summary) {
  const model = SnackPrices.chart(summary.points,summary.today);
  if (!model) return '<div class="chart-empty"><span aria-hidden="true">⌁</span><p>뮤즈의 첫 가격 확인을 기다리고 있어요.</p><small>확인한 날짜의 가격만 그래프에 기록됩니다.</small></div>';
  const lines = model.segments.filter(s=>s.length>1).map(s=>`<polyline points="${s.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>`).join('');
  const dots = model.points.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"><title>${p.date}: ${money(p.value)}원</title></circle>`).join('');
  return `<div class="chart-range"><span>${money(model.max)}원</span><span>배송비 포함 · ${esc(summary.conditionLabel)}</span></div><svg class="price-chart" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="최근 30일 중 ${summary.days}일 확인 가격 그래프, 최저 ${money(summary.low)}원"><path class="chart-baseline" d="M10 77H260"/>${lines}${dots}</svg><div class="chart-dates"><span>${summary.startDate.slice(5).replace('-','.')}</span><span>${summary.today.slice(5).replace('-','.')}</span></div><div class="history-table-wrap"><table><caption>날짜별 확인 가격 · ${esc(summary.conditionLabel)}</caption><thead><tr><th scope="col">확인 날짜</th><th scope="col">배송비 포함</th></tr></thead><tbody>${[...summary.points].reverse().map(p=>`<tr><td>${p.date}</td><td>${money(p.total)}원</td></tr>`).join('')}</tbody></table></div>`;
}
function priceHistoryHtml(p,s) {
  const latestTime=s.lastCheck?.checkedAt || s.latest?.checkedAt;
  const badge=historyUnavailable?'가격 기록 연결 확인 필요':s.badge;
  const lowLabel=s.complete?'30일 확인 최저가':s.days?`${s.days}일 확인 최저가`:'확인 최저가';
  let notice='하루 1회 확인 가격 기준 · 같은 구성과 조건끼리 비교합니다.';
  if(s.paused)notice='등록된 수량과 연결 상품이 달라 가격 추적을 보류했어요.';
  else if(s.failed)notice='마지막 확인을 완료하지 못했어요. 이전 가격을 참고해 주세요.';
  else if(s.stale)notice='오늘 확인 전이에요. 표시 금액은 이전 확인 가격입니다.';
  else if(s.latest&&!s.complete)notice=`최근 30일 중 ${s.days}일 기록 중이에요. 30일 모두 확인되면 최저가 배지를 표시해요.`;
  return `<section class="price-history" aria-label="${esc(p.name)} 가격 기록"><div class="tracking-line"><span class="price-badge ${s.atLow?'is-low':''} ${s.failed||s.paused?'needs-check':''}">${esc(badge)}</span><span class="checked-time">${latestTime?`마지막 확인 <time datetime="${esc(latestTime)}">${dateTime(latestTime)}</time>`:'아직 확인 기록 없음'}</span></div><dl class="price-stats"><div><dt>${lowLabel}</dt><dd>${s.low===null?'—':`${money(s.low)}<small>원</small>`}</dd></div><div><dt>${s.complete?'30일':'확인 기간'} 평균가</dt><dd>${s.average===null?'—':`${money(s.average)}<small>원</small>`}</dd></div></dl>${s.latest&&s.displayDifference!==null&&!s.failed&&!s.paused?`<p class="price-difference">확인 최저가 대비 ${s.displayDifference===0?'같은 가격':`${money(s.displayDifference)}원 높아요`}</p>`:''}<details class="history-details"><summary>${s.days?'가격 그래프·기록 보기':'가격 기록 안내'}<span aria-hidden="true">↗</span></summary><p class="history-notice">${esc(notice)}</p>${graphHtml(s)}</details></section>`;
}
function updateOverview() {
  const stats=products.map(snapshot),tracked=stats.filter(s=>s.latest).length;
  const latest=[...history.checks].sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
  document.querySelector('#trackingStatus').textContent=historyUnavailable?'가격 기록을 불러오지 못했어요':tracked?`${tracked}개 상품 가격 기록 중`:'가격 기록을 기다리고 있어요';
  document.querySelector('#trackingSummary').textContent=latest?`마지막 확인 ${dateTime(latest.checkedAt)} · 하루 1회 확인 기록 기준`:'뮤즈가 확인한 가격이 들어오면 최저가와 그래프가 쌓여요. 기존 금액은 제공 가격입니다.';
}
function render() {
  const summaries=new Map(products.map(p=>[p.id,snapshot(p)]));
  const query=document.querySelector('#search').value.trim().toLowerCase();
  let list=products.filter(p=>(category==='전체'||p.category===category)&&(!onlySaved||saved.has(p.id))&&(!onlyLow||summaries.get(p.id).atLow)&&`${p.name} ${p.desc}`.toLowerCase().includes(query));
  const sort=document.querySelector('#sort').value;
  if(sort!=='original')list.sort((a,b)=>sort==='low'?summaries.get(a.id).total-summaries.get(b.id).total:summaries.get(b.id).total-summaries.get(a.id).total);
  document.querySelector('#resultLabel').textContent=onlyLow?'30일 확인 최저가':onlySaved?'담아둔 간식':category==='전체'?'전체 간식':category;
  document.querySelector('#resultCount').textContent=list.length;
  document.querySelector('#savedCount').textContent=saved.size;
  document.querySelector('#savedToggle').classList.toggle('active',onlySaved);
  document.querySelector('#savedToggle').setAttribute('aria-pressed',onlySaved);
  document.querySelector('#empty').hidden=list.length>0;
  document.querySelector('#empty h3').textContent=onlyLow?'30일 최저가로 확인된 상품이 없어요':'찾는 간식이 없어요';
  document.querySelector('#grid').innerHTML=list.map(p=>{
    const s=summaries.get(p.id);
    return `<article class="product"><div class="product-art" style="--card-bg:#ffffff"><span class="list-number">${String(products.indexOf(p)+1).padStart(2,'0')}</span><button class="save" data-id="${p.id}" aria-label="${esc(p.name)} ${saved.has(p.id)?'담기 취소':'담아두기'}" aria-pressed="${saved.has(p.id)}">${saved.has(p.id)?'♥':'♡'}</button><a class="product-photo-link" href="${esc(p.url)}" target="_blank" rel="sponsored noopener noreferrer" aria-label="${esc(p.name)} 상품 사진으로 쿠팡에서 보기, 새 창"><img class="product-photo" src="${esc(p.image)}" alt="${esc(p.name)} 실제 상품 사진${p.representativeImage?' (구성 참고용)':''}" loading="lazy" decoding="async" width="400" height="400"></a>${p.representativeImage?'<span class="photo-note">대표 사진 · 수량은 설명 확인</span>':''}</div><p class="category">${esc(p.category)}</p><h3>${esc(p.name)}</h3><p class="desc">${esc(p.desc)}</p><p class="price-note">${esc(s.latest?s.conditionLabel:p.priceNote||'')}</p><div class="price-row"><div><span class="current-price-label">${s.latest?'최근 확인가 · 배송비 포함':'제공 가격 · 확인 전'}</span><span class="price">${money(s.total)}<small>원</small></span></div><a class="buy" href="${esc(p.url)}" target="_blank" rel="sponsored noopener noreferrer" aria-label="${esc(p.name)} 쿠팡에서 보기, 새 창">쿠팡에서 보기 ↗</a></div>${priceHistoryHtml(p,s)}</article>`;
  }).join('');
  document.querySelectorAll('.save').forEach(b=>b.addEventListener('click',()=>{
    const id=Number(b.dataset.id),was=saved.has(id);was?saved.delete(id):saved.add(id);
    try{localStorage.setItem('office-snack-saved',JSON.stringify([...saved]));}catch{}
    render();toast(was?'담아둔 간식에서 뺐어요':'우리 팀 간식 후보로 담았어요 ♡');
  }));
  updateOverview();
}
const categories=['전체','케이크','쿠키·비스킷','짭짤한 간식','초코·에너지바','전통과자','캔·병 음료','두유','단백질 음료','아몬드 음료','구운계란'];
document.querySelector('#tabs').innerHTML=categories.map((c,i)=>`<button data-category="${c}" class="${i===0?'active':''}" aria-pressed="${i===0}">${c}</button>`).join('');
document.querySelectorAll('#tabs button').forEach(b=>b.addEventListener('click',()=>{
  category=b.dataset.category;
  document.querySelectorAll('#tabs button').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',t===b);});render();
}));
document.querySelector('#search').addEventListener('input',render);
document.querySelector('#sort').addEventListener('change',render);
document.querySelector('#lowOnly').addEventListener('change',event=>{onlyLow=event.target.checked;render();});
document.querySelector('#savedToggle').addEventListener('click',()=>{onlySaved=!onlySaved;render();document.querySelector('#snacks').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
document.querySelector('#reset').addEventListener('click',()=>{
  category='전체';onlySaved=false;onlyLow=false;document.querySelector('#lowOnly').checked=false;document.querySelector('#search').value='';document.querySelector('#sort').value='original';
  document.querySelectorAll('#tabs button').forEach((b,i)=>{b.classList.toggle('active',i===0);b.setAttribute('aria-pressed',i===0);});render();
});
Promise.all([
  fetch('products.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Products unavailable');return r.json();}),
  fetch('price-history.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('History unavailable');return r.json();}).then(data=>{if(data.schemaVersion!==1||!Array.isArray(data.observations)||!Array.isArray(data.checks))throw Error('Invalid history');return data;}).catch(()=>{historyUnavailable=true;return history;})
]).then(([data,prices])=>{
  products=data;history=prices;saved=new Set([...saved].filter(id=>products.some(p=>p.id===id)));
  try{localStorage.setItem('office-snack-saved',JSON.stringify([...saved]));}catch{}
  render();
}).catch(()=>{document.querySelector('#grid').innerHTML='<p>간식 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>';});
