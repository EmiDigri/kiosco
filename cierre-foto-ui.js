// The draft stays separate from saved closings until the user confirms it.
let cmFotoData = null, cmFotoSaving = false, cmFotoRequest = 0;
const cmFotoNum = CierreCuentas.monto;
function cmComprimirFoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No pude leer la foto'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('La foto esta danada'));
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({image:c.toDataURL('image/jpeg', .9).split(',')[1], mime:'image/jpeg'});
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function cmFotoGastosCaja(context, turno) {
  return (context?.gastos || []).filter(g => g.caja === CM_TURNO_CAJA_ALL[turno]).reduce((s, g) => s + (Number(g.monto) || 0), 0);
}
async function cmFotoConsultar(draft) {
  const request = ++cmFotoRequest, dia = draft.fecha;
  draft.context = null; draft.error = ''; draft.loading = true;
  document.getElementById('cmFotoAceptarMp').checked = false;
  cmRenderFotoCheck();
  try {
    if (!CierreCuentas.fecha(dia, dia) || dia > fechaHoy()) throw new Error('Elegi la fecha real del cuaderno, no una fecha futura.');
    const [pagos, cierres, gastos] = await Promise.all([
      histSbSelectAll(`pagos?fecha=eq.${dia}&order=hora.asc,id.asc`),
      histSbSelectAll(`cierres_caja?fecha=eq.${dia}&order=turno.asc`),
      histSbSelectAll(`gastos_caja?fecha=eq.${dia}&order=created_at.asc`)
    ]);
    if (request !== cmFotoRequest || cmFotoData !== draft) return;
    const local = histGetLocalCierreDia(dia);
    const combined = new Map(cierres.map(c => [c.turno, {...c, once:c.once_monto, synced:true}]));
    Object.entries(local.cierres || {}).forEach(([turno, c]) => { if (!c.synced || !combined.has(turno)) combined.set(turno, {...c, turno}); });
    const allGastos = new Map(gastos.map(g => [g.uid || g.id, {...g, synced:true}]));
    (local.gastos || []).forEach(g => { if (!g.synced || !allGastos.has(g.uid)) allGastos.set(g.uid || cmUid(), {...g}); });
    const mp = Object.fromEntries(CierreCuentas.turnos(dia).map(t => [t, 0]));
    pagos.filter(CierreCuentas.ingreso).forEach(p => { if (p.turno in mp) mp[p.turno] += Number(p.monto) || 0; });
    draft.context = {mp, pagos, cierres:Array.from(combined.values()), gastos:histDeduplicarGastos(Array.from(allGastos.values()))};
  } catch (e) {
    if (request === cmFotoRequest && cmFotoData === draft) draft.error = e.message || 'No pude consultar MP. No se guardo nada.';
  } finally {
    if (request === cmFotoRequest && cmFotoData === draft) {
      draft.loading = false;
      cmRenderFotoReview();
    }
  }
}
async function cmLeerCuaderno(file) {
  if (!file || cmFotoSaving) return;
  if (!/^image\//.test(file.type || '')) { showToast('Elegi una foto del cuaderno'); return; }
  const btn = document.getElementById('cmBtnFoto');
  btn.disabled = true; btn.textContent = 'Leyendo el cuaderno...';
  try {
    const body = await cmComprimirFoto(file);
    const res = await fetch('/api/cierre-foto', {method:'POST', headers:await sbAuthHeaders({'Content-Type':'application/json'}), body:JSON.stringify(body), signal:AbortSignal.timeout(65000)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No pude leer el cuaderno');
    if (!Array.isArray(data.turnos) || !data.turnos.length) throw new Error('No encontre cierres en la foto.');
    cmFotoData = {
      fecha:CierreCuentas.fecha(data.fecha, cmFechaObjetivo) || '', fechaLeida:data.fecha || '', nota:data.nota || '',
      total_dia:cmFotoNum(data.total_dia), context:null, loading:false,
      turnos:data.turnos.map(t => ({cierre:cmFotoNum(t.cierre), mp:cmFotoNum(t.mp), once:cmFotoNum(t.once), mpo:cmFotoNum(t.mpo)})),
      gastos:(data.gastos || []).map(g => ({nombre:String(g.nombre || ''), monto:cmFotoNum(g.monto)}))
    };
    document.getElementById('cmFotoFecha').value = cmFotoData.fecha;
    document.getElementById('cmFotoTotal').value = cmFotoData.total_dia ?? '';
    document.getElementById('cmFotoAceptarMp').checked = false;
    cmRenderFotoReview();
    await cmFotoConsultar(cmFotoData);
  } catch (e) { showToast(e.message || 'No pude leer la foto'); }
  finally { btn.disabled = false; btn.textContent = 'Cargar del cuaderno'; document.getElementById('cmFotoInput').value = ''; }
}
function cmFotoEstado() {
  const draft = cmFotoData;
  if (!draft) return {errores:['No hay foto'], diferencias:[], suma:0};
  const gCaja = Object.fromEntries(CierreCuentas.turnos(draft.fecha).map(t => [t, cmFotoGastosCaja(draft.context, t)]));
  const state = CierreCuentas.validarFoto(draft, draft.context?.mp, draft.fecha, gCaja);
  if (draft.loading) state.errores.unshift('Consultando movimientos y cierres del dia...');
  else if (!draft.context) state.errores.unshift(draft.error || 'Falta consultar los datos del dia.');
  return state;
}
function cmRenderFotoReview() {
  const draft = cmFotoData; if (!draft) return;
  document.getElementById('cmFotoSub').textContent = [draft.fechaLeida && `Fecha leida: ${draft.fechaLeida}`, draft.nota].filter(Boolean).join(' · ');
  const expected = CierreCuentas.turnos(draft.fecha);
  document.getElementById('cmFotoTurnos').innerHTML = draft.turnos.map((t, i) => {
    const turno = expected[i] || `Turno ${i + 1}`, mp = draft.context?.mp[turno];
    const efectivo = mp == null || t.cierre == null || t.once == null ? null : t.cierre - mp - t.once - cmFotoGastosCaja(draft.context, turno);
    return `<div class="cm-foto-turno" data-i="${i}">
      <div class="cm-foto-turno-head"><div class="cm-foto-turno-nombre">${cmEsc(turno)}</div><div class="cm-foto-turno-efectivo">Efectivo ${efectivo == null ? 'pendiente' : cmFmt(efectivo)}</div></div>
      <div class="cm-foto-grid">${[['cierre','Cierre total'],['mp','MP del cuaderno'],['once','Once (incluido)'],['mpo','MPO (dentro de MP)']].map(([key,label]) => `<div class="cm-foto-f"><label for="foto-${i}-${key}">${label}</label><input id="foto-${i}-${key}" type="text" inputmode="decimal" data-f="${key}" value="${t[key] ?? ''}" placeholder="Revisar importe" aria-invalid="${t[key] === null}"></div>`).join('')}
      <div class="cm-foto-f readonly"><label>MP registrado en la app</label><input type="text" readonly value="${mp == null ? 'Pendiente' : cmFmt(mp)}" tabindex="-1"></div></div></div>`;
  }).join('');
  document.querySelectorAll('#cmFotoTurnos .cm-foto-turno').forEach(card => {
    const i = Number(card.dataset.i);
    card.querySelectorAll('input[data-f]').forEach(input => input.addEventListener('input', () => {
      draft.turnos[i][input.dataset.f] = cmFotoNum(input.value);
      input.setAttribute('aria-invalid', String(draft.turnos[i][input.dataset.f] === null));
      document.getElementById('cmFotoAceptarMp').checked = false;
      const t = draft.turnos[i], turno = expected[i], mp = draft.context?.mp[turno];
      card.querySelector('.cm-foto-turno-efectivo').textContent = 'Efectivo ' + (mp == null || t.cierre == null || t.once == null ? 'pendiente' : cmFmt(t.cierre - mp - t.once - cmFotoGastosCaja(draft.context, turno)));
      cmRenderFotoCheck();
    }));
  });
  cmRenderFotoGastos(); cmRenderFotoCheck();
  document.getElementById('cmFotoReview').hidden = false;
}
function cmRenderFotoCheck() {
  if (!cmFotoData) return;
  const s = cmFotoEstado(), accepted = document.getElementById('cmFotoAceptarMp').checked;
  const lines = [...s.errores];
  if (s.diferencias.length) lines.push(`MP difiere del cuaderno en: ${s.diferencias.join(', ')}.`);
  if (!s.errores.length) lines.push(`Total de los cierres: ${cmFmt(s.suma)}${cmFotoData.total_dia == null ? ' (sin total escrito para contrastar)' : ', coincide con el cuaderno'}.`);
  const el = document.getElementById('cmFotoCheck');
  el.className = 'cm-foto-check ' + (s.errores.length || s.diferencias.length ? 'warn' : 'ok');
  el.textContent = lines.join('\n');
  document.getElementById('cmFotoMpAviso').hidden = !s.diferencias.length;
  document.getElementById('cmFotoConfirmar').disabled = cmFotoSaving || !!s.errores.length || (!!s.diferencias.length && !accepted);
}
function cmRenderFotoGastos() {
  if (!cmFotoData) return;
  const draft = cmFotoData, cont = document.getElementById('cmFotoGastos');
  const matches = CierreCuentas.conciliarGastos(draft.gastos, draft.context?.pagos, !!draft.context);
  cont.innerHTML = draft.gastos.map((g, i) => `<div class="cm-foto-gasto" data-i="${i}">
    <input type="text" data-g="nombre" aria-label="Concepto del gasto ${i+1}" value="${cmEsc(g.nombre)}" placeholder="Concepto">
    <input type="text" inputmode="decimal" data-g="monto" aria-label="Importe del gasto ${i+1}" value="${g.monto ?? ''}" placeholder="Revisar importe">
    <button type="button" data-del="${i}" class="cm-foto-gasto-del" aria-label="Quitar gasto ${i+1}">×</button>
    <span class="cm-foto-medio">${cmEsc(matches[i].texto)}</span></div>`).join('') || '<div class="cm-foto-medio">Sin gastos leidos</div>';
  cont.querySelectorAll('.cm-foto-gasto').forEach(row => {
    const i = Number(row.dataset.i);
    const update = () => {
      draft.gastos[i].nombre = row.querySelector('[data-g="nombre"]').value;
      draft.gastos[i].monto = cmFotoNum(row.querySelector('[data-g="monto"]').value);
      const updated = CierreCuentas.conciliarGastos(draft.gastos, draft.context?.pagos, !!draft.context);
      cont.querySelectorAll('.cm-foto-medio').forEach((el, j) => { el.textContent = updated[j].texto; });
      cmRenderFotoCheck();
    };
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', update));
    row.querySelector('[data-del]').addEventListener('click', () => { draft.gastos.splice(i, 1); cmRenderFotoGastos(); cmRenderFotoCheck(); });
  });
}
function cmFotoAgregarGastoFila() { if (cmFotoData) { cmFotoData.gastos.push({nombre:'', monto:null}); cmRenderFotoGastos(); cmRenderFotoCheck(); } }
function cmCerrarFotoReview() {
  if (cmFotoSaving) return;
  ++cmFotoRequest; cmFotoData = null;
  document.getElementById('cmFotoReview').hidden = true;
}
function cmFotoGuardarLocal(fecha, cierres, gastos) {
  const all = JSON.parse(localStorage.getItem(CM_STORAGE_KEY) || '{}');
  all[fecha] = {cierres, gastos, guardadoEn:new Date().toISOString()};
  localStorage.setItem(CM_STORAGE_KEY, JSON.stringify(all));
}
function cmFotoSincronizado(fecha, key, item) {
  const all = JSON.parse(localStorage.getItem(CM_STORAGE_KEY) || '{}'), day = all[fecha];
  const saved = key === 'cierres' ? day?.cierres[item.turno] : day?.gastos.find(g => g.uid === item.uid);
  if (saved && (key !== 'cierres' || saved.guardadoEn === item.guardadoEn)) saved.synced = true;
  localStorage.setItem(CM_STORAGE_KEY, JSON.stringify(all));
}
async function cmConfirmarCuaderno() {
  if (!cmFotoData || cmFotoSaving || document.getElementById('cmFotoConfirmar').disabled) return;
  const draft = cmFotoData, accepted = document.getElementById('cmFotoAceptarMp').checked;
  const previous = JSON.stringify(draft.context), edited = JSON.stringify([draft.turnos, draft.gastos, draft.fecha, draft.total_dia]);
  cmFotoSaving = true; cmRenderFotoCheck();
  try {
    await cmFotoConsultar(draft);
    if (cmFotoData !== draft) return;
    if (JSON.stringify(draft.context) !== previous || JSON.stringify([draft.turnos, draft.gastos, draft.fecha, draft.total_dia]) !== edited) {
      showToast('Los datos cambiaron durante la revision. Revisalos antes de confirmar.'); return;
    }
    document.getElementById('cmFotoAceptarMp').checked = accepted;
    const state = cmFotoEstado();
    if (state.errores.length || (state.diferencias.length && !accepted)) return;
    if (draft.context.cierres.length && !confirm('Ya hay cierres guardados para este dia. ¿Reemplazarlos con los de esta foto? Los gastos existentes se conservan.')) return;
    document.querySelectorAll('#cmFotoReview input, #cmFotoReview button').forEach(el => { el.disabled = true; });
    const fecha = draft.fecha, expected = CierreCuentas.turnos(fecha), stamp = new Date().toISOString();
    const gastos = draft.context.gastos.map(g => ({...g})), used = new Set(), nuevos = [], occurrences = new Map();
    for (const g of draft.gastos) {
      const key = JSON.stringify([CierreCuentas.nombre(g.nombre), g.monto]), occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      const index = gastos.findIndex((x, i) => !used.has(i) && CierreCuentas.nombre(x.nombre) === CierreCuentas.nombre(g.nombre) && Number(x.monto) === g.monto);
      if (index >= 0) { used.add(index); continue; }
      const nuevo = {uid:await CierreCuentas.idGastoFoto(fecha, g, occurrence), nombre:g.nombre.trim(), monto:g.monto, caja:'', turno:'', creadoEn:stamp};
      used.add(gastos.length); gastos.push(nuevo); nuevos.push(nuevo);
    }
    const cierres = Object.fromEntries(draft.context.cierres.map(c => [c.turno, {...c}]));
    draft.turnos.forEach((t, i) => {
      const turno = expected[i], mp = draft.context.mp[turno], gCaja = cmFotoGastosCaja(draft.context, turno);
      cierres[turno] = {turno, apertura:Number(cierres[turno]?.apertura) || 0, efectivo:t.cierre-mp-t.once-gCaja, once:t.once, mpo:t.mpo, mp, total_turno:t.cierre, guardadoEn:stamp};
    });
    cmFotoGuardarLocal(fecha, cierres, gastos);
    let fallos = 0;
    // Date and amounts are captured: switching another view cannot redirect these writes.
    for (const g of nuevos) {
      try { await cmGuardarGastoRemoto(g, fecha); g.synced = true; cmFotoSincronizado(fecha, 'gastos', g); } catch { fallos++; }
    }
    for (const turno of expected) {
      try { await cmGuardarCierreRemoto(turno, cierres[turno], fecha, cmFotoGastosCaja(draft.context, turno)); cierres[turno].synced = true; cmFotoSincronizado(fecha, 'cierres', cierres[turno]); } catch { fallos++; }
    }
    cmFechaObjetivo = fecha; cmCierres = cierres; cmGastos = gastos; cmMpPorTurnoCache = draft.context.mp;
    const domingo = cmEsDomingo(fecha);
    CM_TURNOS = expected; CM_COLORS = cmColoresDe(domingo); CM_TURNO_CAJA = cmTurnoCajaDe(domingo); CM_CAJA_TURNO = cmCajaTurnoDe(domingo);
    cmTurnoActivo = expected[0];
    document.getElementById('cmHeaderFecha').textContent = formatFecha(fecha);
    document.getElementById('cmMpTurnoPrefix').textContent = domingo ? '' : 'turno ';
    document.getElementById('cmHintCajas').textContent = domingo ? 'CM = Turno 1 · CT = Turno 2.' : 'CM = Vale · CT = Ani · CN = Marta.';
    document.querySelector('.cm-caja-btn[data-caja="CN"]').style.display = domingo ? 'none' : '';
    cmCargarFormularioTurno(); cmRenderGastos(); cmRenderResumen(); cmRenderSyncStatus();
    cmFotoSaving = false; cmCerrarFotoReview();
    showToast(fallos ? `Guardado en este equipo: ${fallos} registros pendientes de sincronizar.` : 'Cierres y gastos guardados en el Historial.');
    if (document.getElementById('historialOverlay').classList.contains('open')) await histCargarMes();
  } catch (e) { showToast(e.message || 'No se pudo guardar el cierre.'); }
  finally { cmFotoSaving = false; document.querySelectorAll('#cmFotoReview input, #cmFotoReview button').forEach(el => { el.disabled = false; }); cmRenderFotoCheck(); }
}
document.getElementById('cmBtnFoto').addEventListener('click', () => document.getElementById('cmFotoInput').click());
document.getElementById('cmFotoInput').addEventListener('change', e => cmLeerCuaderno(e.target.files[0]));
document.getElementById('cmFotoFecha').addEventListener('change', async e => { if (cmFotoData && !cmFotoSaving) { cmFotoData.fecha = e.target.value; await cmFotoConsultar(cmFotoData); } });
document.getElementById('cmFotoTotal').addEventListener('input', e => { if (cmFotoData) { cmFotoData.total_dia = cmFotoNum(e.target.value); cmRenderFotoCheck(); } });
document.getElementById('cmFotoAceptarMp').addEventListener('change', cmRenderFotoCheck);
document.getElementById('cmFotoCerrar').addEventListener('click', cmCerrarFotoReview);
document.getElementById('cmFotoCancelar').addEventListener('click', cmCerrarFotoReview);
document.getElementById('cmFotoConfirmar').addEventListener('click', cmConfirmarCuaderno);
document.getElementById('cmFotoAddGasto').addEventListener('click', cmFotoAgregarGastoFila);
