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
    check(CierreCuentas.conciliarGastos(db.gastos,db.pagos)[0].medio==='efectivo','photo expense initially classified as cash');
    await loadExample();await cmConfirmarCuaderno();
    check(db.cierres.length===3&&db.gastos.length===1,'reimport does not duplicate shifts or expenses');
    db.pagos.push({id:9,fecha:fixed,es_enviada:true,monto:254403,nombre:'Arcor SA',status:'approved'});renderMonth();
    check(CierreCuentas.conciliarGastos(db.gastos,db.pagos)[0].medio==='mp','later MP outgoing reclassifies photo expense');
    check(document.querySelector('.hist-kiosco').textContent.includes('$254.403'),'outgoing is not counted as a second expense');
    db.failRead=true;await loadExample();
    check(document.getElementById('cmFotoConfirmar').disabled,'read outage cannot invent MP zero');
    db.failRead=false;resetFixture();await loadExample();db.failWrite=true;await cmConfirmarCuaderno();
    check(cmContarPendientes()===4,'failed writes remain pending without claiming sync');
    db.failWrite=false;await cmSyncLocales();
    check(cmContarPendientes()===0&&db.cierres.length===3&&db.gastos.length===1,'retry synchronizes without duplicates');
    fixtureToday='2026-09-13';
    for(const sunday of ['2026-09-06','2026-09-13']){
      resetFixture();sessionStorage.removeItem(CM_FOTO_CACHE);cmFotoLecturas=[];
      const sundayPhoto={...example(),fecha:sunday,turnos:example().turnos.slice(0,2),total_dia:1024050};
      db.pagos=sundayPhoto.turnos.map((t,i)=>({id:i+1,fecha:sunday,turno:'Turno '+(i+1),monto:t.mp,es_enviada:false,status:'approved'}));
      // Outgoing and returned transfers are not income, on Sundays either.
      db.pagos.push({id:90,fecha:sunday,turno:'Turno 1',monto:254403,nombre:'Arcor SA',es_enviada:true,status:'approved'},
        {id:91,fecha:sunday,turno:'Turno 2',monto:10000,devuelta:true,status:'approved'});
      const fixtureFetch=window.fetch;
      let sundayReads=0;
      window.fetch=async(url,opts)=>url==='/api/cierre-foto'?(sundayReads++,new Response(JSON.stringify(sundayPhoto),{status:200})):fixtureFetch(url,opts);
      try{await cmLeerCuaderno(photo);}finally{window.fetch=fixtureFetch;}
      check(sundayReads===1,'Sunday upload makes one mocked AI read: '+sunday);
      check(document.querySelectorAll('#cmFotoTurnos .cm-foto-turno').length===2,'Sunday review renders exactly two shifts: '+sunday);
      check([...document.querySelectorAll('.cm-foto-turno-nombre')].map(el=>el.textContent).join(',')==='Turno 1,Turno 2','Sunday uses order, not weekday employee names');
      check(!document.getElementById('cmFotoConfirmar').disabled,'complete Sunday can be confirmed');
      await cmConfirmarCuaderno();
      check(db.cierres.length===2&&db.cierres.every(c=>c.fecha===sunday&&c.turno.startsWith('Turno ')),'Sunday saves two shifts to the photo date: '+sunday);
      check(db.gastos.length===1&&db.gastos[0].fecha===sunday,'Sunday expense saved once on its own date');
      check(document.getElementById('cmTotalDiaSub').textContent==='2 de 2 turnos cerrados','Sunday is complete without a third shift');
      check(document.querySelectorAll('#cmTurnoRow button').length===2&&document.querySelector('.cm-caja-btn[data-caja="CN"]').style.display==='none','Sunday editor hides the third shift and third cash box');
      const days=histAgruparPorDia(db.pagos,db.cierres,db.gastos),totals=CierreCuentas.resumenMes(days,sunday,sunday);
      check(totals.total===1024050&&totals.mp===423050&&totals.efectivo===601000,'Sunday totals count cash, MP and Once once');
      check(totals.cerrados===2&&totals.esperados===2&&totals.completos===1&&totals.gastos===254403,'history and monthly totals recognize a complete Sunday');
      cmFotoData=structuredClone(sundayPhoto);cmRenderFotoReview();await cmFotoConsultar(cmFotoData);await cmConfirmarCuaderno();
      check(db.cierres.length===2&&db.gastos.length===1,'reimporting Sunday creates no duplicate closings or expenses');
      cmFotoData={...structuredClone(sundayPhoto),turnos:[...sundayPhoto.turnos,example().turnos[2]]};cmRenderFotoReview();await cmFotoConsultar(cmFotoData);
      check(document.getElementById('cmFotoConfirmar').disabled&&cmFotoEstado().errores.some(e=>e.includes('2 turnos')),'invented third Sunday shift blocks saving');
      cmFotoData={...structuredClone(sundayPhoto),turnos:sundayPhoto.turnos.slice(0,1)};cmRenderFotoReview();await cmFotoConsultar(cmFotoData);
      check(document.getElementById('cmFotoConfirmar').disabled,'incomplete Sunday photo blocks saving');
      cmCerrarFotoReview();
    }
    resetFixture();const saturday='2026-09-12';
    db.pagos=example().turnos.map((t,i)=>({id:i+1,fecha:saturday,turno:['Vale','Ani','Marta'][i],monto:t.mp,status:'approved'}));
    cmFotoData={...example(),fecha:saturday};cmRenderFotoReview();await cmFotoConsultar(cmFotoData);await cmConfirmarCuaderno();
    check(db.cierres.length===3&&document.getElementById('cmTotalDiaSub').textContent==='3 de 3 turnos cerrados','Saturday still uses three shifts after importing a Sunday');
    resetFixture();
    await loadExample();report();
  }catch(e){results.push('FAIL '+e.stack);document.getElementById('qaResults').textContent=results.join('\n');document.body.dataset.qa='failed';}
})();
