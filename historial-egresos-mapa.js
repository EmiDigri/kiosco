(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.HistorialEgresosMapa=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const PAGE_SIZE=5;
  const states=new WeakMap();

  function amount(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>0?number:0;
  }

  function isTrue(value){
    return value===true||String(value).toLowerCase()==='true';
  }

  function isValidMpExpense(row){
    return !!row&&isTrue(row.es_enviada)&&!isTrue(row.devuelta)&&(!row.status||row.status==='approved')&&amount(row.monto)>0;
  }

  function fallbackConcept(value){
    const text=String(value||'').trim();
    if(!text)return 'Otro concepto';
    if(/^pago\s+(?:de|producto\s+de)$/i.test(text)||/^pago\s+f[áa]cil(?:\s|$)/i.test(text))return text;
    return text.replace(/^pago\s+(?:producto\s+de\s+|de\s+)?/i,'')||text;
  }

  function fold(value){
    return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-AR').trim();
  }

  function prepare(gastos,pagos,cleanName){
    const clean=typeof cleanName==='function'?cleanName:fallbackConcept;
    const rows=[];
    for(const row of gastos||[]){
      const monto=amount(row&&row.monto);
      if(monto)rows.push({...row,monto,medio:'efectivo',concepto:clean(row.nombre)});
    }
    for(const row of (pagos||[]).filter(isValidMpExpense)){
      rows.push({...row,monto:amount(row.monto),medio:'mp',concepto:clean(row.nombre)});
    }
    return rows;
  }

  function group(rows,mode='todos'){
    const groups=new Map();
    for(const row of rows||[]){
      if(mode!=='todos'&&row.medio!==mode)continue;
      const nombre=String(row.concepto||'Otro concepto').trim()||'Otro concepto';
      const key=fold(nombre);
      if(!groups.has(key))groups.set(key,{nombre,total:0,items:[],medios:new Set()});
      const current=groups.get(key);
      current.total+=amount(row.monto);
      current.items.push(row);
      current.medios.add(row.medio);
    }
    return [...groups.values()].map(item=>({...item,medios:[...item.medios]}))
      .sort((a,b)=>b.total-a.total||a.nombre.localeCompare(b.nombre,'es'));
  }

  function page(groups,depth=0,size=PAGE_SIZE){
    const start=Math.max(0,depth)*size;
    const visible=groups.slice(start,start+size);
    const remaining=groups.slice(start+size);
    return {
      start,
      visible,
      remaining,
      remainingTotal:remaining.reduce((sum,item)=>sum+item.total,0)
    };
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function defaultMoney(value){
    return '$'+Number(value||0).toLocaleString('es-AR',{maximumFractionDigits:2});
  }

  function defaultCompact(value){
    const number=Number(value)||0;
    if(number>=1e6)return '$'+(number/1e6).toLocaleString('es-AR',{maximumFractionDigits:1})+' M';
    if(number>=1e3)return '$'+(number/1e3).toLocaleString('es-AR',{maximumFractionDigits:1})+' mil';
    return defaultMoney(number);
  }

  function mediumLabel(medios){
    if(medios.length>1)return 'Efectivo + Mercado Pago';
    return medios[0]==='mp'?'Mercado Pago':'Efectivo';
  }

  function dateLabel(value){
    const raw=String(value||'');
    return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw.slice(8,10)+'/'+raw.slice(5,7):raw;
  }

  function filteredGroups(state){
    let groups=group(state.rows,state.mode);
    if(state.query){
      const needle=fold(state.query);
      groups=groups.filter(item=>fold(item.nombre).includes(needle));
    }
    return groups;
  }

  function tileHtml(item,index,money,compact){
    const share=item.total>0&&item.scopeTotal>0?Math.round(item.total/item.scopeTotal*100):0;
    return `<button type="button" class="hem-tile hem-tone-${index%5}" data-hem-group="${escapeHtml(item.key)}" aria-label="Ver detalle de ${escapeHtml(item.nombre)}, ${escapeHtml(money(item.total))}">
      <span class="hem-tile-name">${escapeHtml(item.nombre)}</span>
      <strong>${escapeHtml(compact(item.total))}</strong>
      <span class="hem-tile-meta">${item.items.length} ${item.items.length===1?'movimiento':'movimientos'} · ${share}%</span>
    </button>`;
  }

  function selectedHtml(state,selected,money){
    if(!selected)return `<div class="hem-empty-detail" aria-live="polite">Tocá un bloque para ver fechas y medios de pago.</div>`;
    const items=selected.items.slice().sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||''))||String(b.hora||'').localeCompare(String(a.hora||'')));
    const rows=items.map(item=>`<div class="hem-detail-row"><span>${escapeHtml(dateLabel(item.fecha))}${item.hora?` · ${escapeHtml(String(item.hora).slice(0,5))}`:''}</span><span>${item.medio==='mp'?'Mercado Pago':'Efectivo'}</span><strong>${escapeHtml(money(item.monto))}</strong></div>`).join('');
    return `<section class="hem-detail" aria-live="polite">
      <div class="hem-detail-head"><div><span>Detalle del concepto</span><strong>${escapeHtml(selected.nombre)}</strong></div><button type="button" data-hem-close aria-label="Cerrar detalle" title="Cerrar detalle">×</button></div>
      <div class="hem-detail-summary"><strong>${escapeHtml(money(selected.total))}</strong><span>${items.length} ${items.length===1?'movimiento':'movimientos'} · ${escapeHtml(mediumLabel(selected.medios))}</span></div>
      <div class="hem-detail-list">${rows}</div>
    </section>`;
  }

  function paint(container,state){
    const groups=filteredGroups(state);
    const scopeTotal=groups.reduce((sum,item)=>sum+item.total,0);
    const overallGroups=group(state.rows,state.mode);
    const modeTotal=overallGroups.reduce((sum,item)=>sum+item.total,0);
    const current=page(groups,state.depth);
    const maxDepth=Math.max(0,Math.ceil(groups.length/PAGE_SIZE)-1);
    if(state.depth>maxDepth){state.depth=maxDepth;return paint(container,state);}
    const keyed=current.visible.map((item,index)=>({...item,key:String(current.start+index),scopeTotal}));
    let tiles=keyed.map((item,index)=>tileHtml(item,index,state.money,state.compact)).join('');
    if(current.remaining.length){
      tiles+=`<button type="button" class="hem-tile hem-other" data-hem-more aria-label="Ver ${current.remaining.length} conceptos restantes">
        <span class="hem-tile-name">Otros conceptos</span><strong>${escapeHtml(state.compact(current.remainingTotal))}</strong><span class="hem-tile-meta">${current.remaining.length} restantes <span aria-hidden="true">→</span></span>
      </button>`;
    }
    const resultCount=groups.length;
    if(!tiles)tiles=`<div class="hem-no-results">No encontré conceptos con esa búsqueda.</div>`;
    const selected=state.selectedKey?groups.find(item=>fold(item.nombre)===state.selectedKey):null;
    const context=state.query
      ?`${resultCount} ${resultCount===1?'resultado':'resultados'}`
      :state.depth?`Conceptos ${current.start+1}–${Math.min(current.start+PAGE_SIZE,groups.length)} de ${groups.length}`
      :`${groups.length} ${groups.length===1?'concepto':'conceptos'}`;

    container.innerHTML=`<details class="hist-egresos hist-mes-sec hem-card" data-mes-sec="egresos" open>
      <summary class="hist-egresos-head hist-mes-head hem-summary"><span class="hist-mes-head-txt">↗ Egresos del mes</span><strong>-${escapeHtml(state.money(modeTotal))}</strong></summary>
      <div class="hem-body">
        <div class="hem-toolbar">
          <label class="hem-search"><span aria-hidden="true">⌕</span><input type="search" value="${escapeHtml(state.query)}" placeholder="Buscar concepto" aria-label="Buscar concepto o proveedor"></label>
          <div class="hem-tabs" role="group" aria-label="Filtrar egresos por medio">
            <button type="button" data-hem-mode="todos" class="${state.mode==='todos'?'active':''}">Todos</button>
            <button type="button" data-hem-mode="efectivo" class="${state.mode==='efectivo'?'active':''}">Efectivo</button>
            <button type="button" data-hem-mode="mp" class="${state.mode==='mp'?'active':''}">Mercado Pago</button>
          </div>
        </div>
        <div class="hem-map-head"><span>${escapeHtml(context)}</span>${state.depth?'<button type="button" data-hem-back><span aria-hidden="true">←</span> Anteriores</button>':''}</div>
        <div class="hem-grid hem-count-${Math.min(6,keyed.length+(current.remaining.length?1:0))}">${tiles}</div>
        ${selectedHtml(state,selected,state.money)}
      </div>
    </details>`;

    const input=container.querySelector('.hem-search input');
    input&&input.addEventListener('input',event=>{
      state.query=event.target.value;
      state.depth=0;
      state.selectedKey='';
      paint(container,state);
      const next=container.querySelector('.hem-search input');
      if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length);}
    });
    container.querySelectorAll('[data-hem-mode]').forEach(button=>button.addEventListener('click',()=>{
      state.mode=button.dataset.hemMode;
      state.depth=0;
      state.selectedKey='';
      paint(container,state);
    }));
    container.querySelector('[data-hem-more]')?.addEventListener('click',()=>{state.depth++;state.selectedKey='';paint(container,state);});
    container.querySelector('[data-hem-back]')?.addEventListener('click',()=>{state.depth=Math.max(0,state.depth-1);state.selectedKey='';paint(container,state);});
    container.querySelectorAll('[data-hem-group]').forEach(button=>button.addEventListener('click',()=>{
      const item=keyed[Number(button.dataset.hemGroup)-current.start];
      if(item){state.selectedKey=fold(item.nombre);paint(container,state);container.querySelector('.hem-detail')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
    }));
    container.querySelector('[data-hem-close]')?.addEventListener('click',()=>{state.selectedKey='';paint(container,state);});
  }

  function render(options){
    const container=options&&options.container;
    if(!container)return;
    const rows=prepare(options.gastos,options.pagos,options.cleanName);
    if(!rows.length){container.innerHTML='';states.delete(container);return;}
    const previous=states.get(container);
    const state={
      rows,
      mode:previous?.mode||'todos',
      query:previous?.query||'',
      depth:0,
      selectedKey:'',
      money:options.money||defaultMoney,
      compact:options.compact||defaultCompact
    };
    states.set(container,state);
    paint(container,state);
  }

  return {PAGE_SIZE,isValidMpExpense,prepare,group,page,render,fold,fallbackConcept};
});
