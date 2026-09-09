(async()=>{
  if(!new URLSearchParams(location.search).has('test'))return;
  const results=[],check=(condition,label)=>{if(!condition)throw Error(label);results.push('OK '+label);};
  const report=()=>{document.getElementById('qaResults').textContent=results.join('\n');document.body.dataset.qa='passed';};
  try{
    check(!document.getElementById('cmFotoInput').hasAttribute('capture'),'gallery upload does not force camera capture');
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=320;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,240,320);ctx.fillStyle='black';ctx.fillText('Cierre 521450',20,40);
    for(const mime of ['image/jpeg','image/png','image/webp']){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime));
      check(blob?.type===mime,'browser fixture encodes '+mime);
      const file=new File([blob],'cuaderno.'+mime.split('/')[1],{type:mime});
      const result=await cmComprimirFoto(file);
      check(result.mime==='image/jpeg'&&result.image.startsWith('/9j/'),'saved '+mime+' converts to API JPEG');
    }
    try{await cmComprimirFoto(new File(['invalid image'],'cuaderno.heic',{type:'image/heic'}));throw Error('invalid image accepted');}
    catch(e){check(e.message.includes('JPG, PNG o WebP'),'unsupported or damaged image offers a usable format');}
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
    const photo=new File([jpeg],'cuaderno.jpg',{type:'image/jpeg'}), originalFetch=window.fetch;
    let reads=0;
    sessionStorage.removeItem(CM_FOTO_CACHE);cmFotoLecturas=[];
    window.fetch=async(url,opts)=>{if(url==='/api/cierre-foto'){reads++;return new Response(JSON.stringify(example()),{status:200});}return originalFetch(url,opts);};
    try{
      const first=cmLeerCuaderno(photo), concurrent=cmLeerCuaderno(photo);
      await first;await concurrent;
      check(reads===1,'concurrent uploads only request one AI read');
      check([...document.querySelectorAll('#cmFotoTurnos .cm-foto-turno:first-child input[data-f]')].map(e=>e.dataset.f).join(',')==='cierre,mp,mpo,once','review follows notebook column order');
      const amount=document.getElementById('foto-0-cierre');amount.value='530000';amount.dispatchEvent(new Event('input',{bubbles:true}));
      cmCerrarFotoReview();cmFotoLecturas=[];
      await cmLeerCuaderno(photo);
      check(reads===1&&cmFotoData.turnos[0].cierre===530000,'reopening the same file restores edited numbers without an AI call');
      check(!sessionStorage.getItem(CM_FOTO_CACHE).includes('image')&&!sessionStorage.getItem(CM_FOTO_CACHE).includes('/9j/'),'cached draft contains no photo');
      db.pagos[0].monto=248350;
      await cmLeerCuaderno(photo);
      check(reads===1&&cmFotoData.context.mp.Vale===248350,'cached OCR still checks fresh MP data');
      cmFotoData.turnos[0].mp=921450;cmRenderFotoReview();document.getElementById('cmFotoAceptarMp').checked=true;cmRenderFotoCheck();
      check(document.getElementById('cmFotoConfirmar').disabled,'acknowledging MP mismatch cannot approve impossible OCR');
      fixtureOwner='another@kiosco.test';
      await cmLeerCuaderno(photo);
      check(reads===2&&cmFotoData.turnos[0].cierre===521450,'cached drafts are scoped to the signed-in account');
      const expired=JSON.parse(sessionStorage.getItem(CM_FOTO_CACHE));expired.forEach(r=>r.hasta=0);sessionStorage.setItem(CM_FOTO_CACHE,JSON.stringify(expired));
      await cmLeerCuaderno(photo);
      check(reads===3,'expired cached reads are not reused');
    }finally{window.fetch=originalFetch;fixtureOwner='fixture@kiosco.test';cmCerrarFotoReview();sessionStorage.removeItem(CM_FOTO_CACHE);cmFotoLecturas=[];}
    resetFixture();await loadExample();
    check(!document.getElementById('cmFotoConfirmar').disabled,'valid sample can be confirmed');
    check(document.querySelectorAll('#cmFotoTurnos .cm-foto-turno').length===3,'three shifts rendered');
    check(!document.querySelector('#cmFotoTurnos [data-f="apertura"]'),'opening float is not extracted');
    cmFotoData.turnos[0].cierre=null;cmRenderFotoReview();
    check(document.getElementById('cmFotoConfirmar').disabled,'unreadable closing blocks saving');
    await loadExample();cmFotoData.turnos[0].mp=100;cmRenderFotoReview();
    check(document.getElementById('cmFotoConfirmar').disabled,'MP mismatch blocks unconfirmed save');
    await loadExample();await cmConfirmarCuaderno();
    check(db.cierres.length===3&&db.gastos.length===1,'all closings and expense persisted');
    check(db.cierres.reduce((s,c)=>s+c.total_turno,0)===1681800,'persisted revenue exactly matches the photo');
    check(db.writes.every(w=>w.row.fecha===fixed),'writes use the photo date');
    check(db.writes.every(w=>!('image' in w.row)),'no photo stored');
    check(db.cierres.reduce((s,c)=>s+c.efectivo+c.once_monto,0)===968500,'cash and Once are counted once');
    renderMonth();
    check(document.querySelector('.hist-kiosco').textContent.includes('$1.681.800'),'monthly headline includes cash');
    check(document.getElementById('histGastosMes').textContent.includes('Arcor'),'expense appears in monthly history');
    check(document.querySelector('#histGastosMes .hist-gasto-meta').textContent.endsWith('Efectivo'),'expense initially assumed cash');
    await loadExample();await cmConfirmarCuaderno();
    check(db.cierres.length===3&&db.gastos.length===1,'reimport does not duplicate shifts or expenses');
    db.pagos.push({id:9,fecha:fixed,es_enviada:true,monto:254403,nombre:'Arcor SA',status:'approved'});renderMonth();
    check(document.querySelector('#histGastosMes .hist-gasto-meta').textContent.endsWith('MP'),'later MP outgoing reclassifies expense');
    check(document.querySelector('.hist-kiosco').textContent.includes('$254.403'),'outgoing is not counted as a second expense');
    db.failRead=true;await loadExample();
    check(document.getElementById('cmFotoConfirmar').disabled,'read outage cannot invent MP zero');
    db.failRead=false;resetFixture();await loadExample();db.failWrite=true;await cmConfirmarCuaderno();
    check(cmContarPendientes()===4,'failed writes remain pending without claiming sync');
    db.failWrite=false;await cmSyncLocales();
    check(cmContarPendientes()===0&&db.cierres.length===3&&db.gastos.length===1,'retry synchronizes without duplicates');
    resetFixture();const sunday='2026-09-06';
    db.pagos=example().turnos.slice(0,2).map((t,i)=>({id:i+1,fecha:sunday,turno:'Turno '+(i+1),monto:t.mp,es_enviada:false,status:'approved'}));
    cmFotoData={...example(),fecha:sunday,turnos:example().turnos.slice(0,2),total_dia:1024050};
    cmRenderFotoReview();await cmFotoConsultar(cmFotoData);await cmConfirmarCuaderno();
    check(db.cierres.length===2&&db.cierres.every(c=>c.fecha===sunday&&c.turno.startsWith('Turno ')),'past Sunday saves two shifts to the correct date');
    check(db.gastos[0].fecha===sunday,'photo expense uses the past date too');
    resetFixture();
    await loadExample();report();
  }catch(e){results.push('FAIL '+e.stack);document.getElementById('qaResults').textContent=results.join('\n');document.body.dataset.qa='failed';}
})();
