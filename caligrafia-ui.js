(function() {
  'use strict';
  const entry = document.getElementById('cmBtnFoto');
  if (!entry) return;
  const icon = name => `<span class="cal-icon" aria-hidden="true" style="--cal-icon:url('/vendor/lucide/${name}.svg')"></span>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'cm-foto-btn cal-entry';
  button.id = 'cmCaligrafia'; button.innerHTML = icon('scan-text') + ' Caligrafía · prueba';
  entry.after(button);
  let dialog, cropper, selectedFile, currentFile, sourceHash, busy = false, sampleId, runId, cropSequence = 0;
  let examples = [], runs = [], dependencies;
  document.getElementById('cmFotoInput').addEventListener('change', e => { selectedFile = e.target.files?.[0]; });
  const $ = id => document.getElementById(id);
  function asset(tag, attrs) {
    return new Promise((resolve, reject) => {
      const el = Object.assign(document.createElement(tag), attrs);
      el.onload = resolve; el.onerror = () => { el.remove(); reject(Error('No se pudo abrir el selector de recortes.')); };
      document.head.append(el);
    });
  }
  async function loadDependencies() {
    if (!dependencies) dependencies = Promise.all([
      asset('link', {rel: 'stylesheet', href: '/vendor/cropper/cropper.min.css'}),
      asset('script', {src: '/vendor/cropper/cropper.min.js'}),
      asset('script', {src: '/caligrafia-core.js'})
    ]).catch(error => { dependencies = null; throw error; });
    return dependencies;
  }
  async function api(method, body, suffix = '') {
    const res = await fetch('/api/caligrafia' + suffix, {method, headers: await sbAuthHeaders({'Content-Type':'application/json'}),
      ...(body ? {body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(method === 'POST' && body?.action === 'compare' ? 110000 : 30000)});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || 'No se pudo completar la operación.');
    return data;
  }
  function status(message, error = false) { $('calStatus').textContent = message; $('calStatus').classList.toggle('error', error); }
  function lock(value) {
    busy = value;
    dialog.querySelectorAll('input,select,button:not([data-close])').forEach(el => { el.disabled = value; });
    if (cropper) value ? cropper.disable() : cropper.enable();
    $('calCompare').textContent = runId ? 'Consultar resultado · sin cargo' : 'Comparar · 2 consultas de IA';
  }
  function build() {
    dialog = document.createElement('dialog'); dialog.id = 'calDialog'; dialog.setAttribute('aria-labelledby','calTitle');
    dialog.innerHTML = `<header class="cal-head"><div><span class="cal-eyebrow">PRUEBA CONTROLADA</span><h2 id="calTitle">Caligrafía</h2></div><button type="button" data-close class="cal-tool" title="Cerrar" aria-label="Cerrar">${icon('x')}</button></header>
      <div class="cal-body"><div class="cal-fields">
        <label>Quién escribió este recorte<input id="calWriter" list="calWriters" maxlength="40" placeholder="Nombre de la persona" autocomplete="off" required></label>
        <datalist id="calWriters"></datalist><label>Fecha de la hoja<input id="calDate" type="date" required></label>
        <label>Contenido<select id="calKind"><option value="importe">Importe</option><option value="nombre">Nombre de gasto</option></select></label>
      </div><div class="cal-workspace"><section class="cal-source" aria-label="Foto y recorte">
        <div class="cal-toolbar"><button type="button" id="calChoose">${icon('image-up')} Elegir foto</button><span id="calFilename"></span>
          <button type="button" class="cal-tool" data-zoom="0.15" title="Acercar" aria-label="Acercar">${icon('zoom-in')}</button>
          <button type="button" class="cal-tool" data-zoom="-0.15" title="Alejar" aria-label="Alejar">${icon('zoom-out')}</button>
          <button type="button" class="cal-tool" id="calRotate" title="Girar foto" aria-label="Girar foto">${icon('rotate-ccw')}</button>
        </div><input id="calFile" type="file" accept="image/*,.heic,.heif" hidden>
        <div class="cal-canvas"><img id="calPhoto" alt="Foto del cuaderno para seleccionar un recorte" hidden><span id="calEmpty">Sin foto seleccionada</span></div>
        <details class="cal-coordinates"><summary>Ajuste del recorte</summary><div>${['X','Y','Ancho','Alto'].map((label,i) => `<label>${label}<input type="number" min="0" step="1" data-coordinate="${['x','y','width','height'][i]}" aria-label="${label} en píxeles"></label>`).join('')}</div></details>
      </section><section class="cal-check" aria-label="Transcripción del recorte">
        <h3>Recorte seleccionado</h3><div class="cal-preview"></div>
        <label>Transcripción verificada<input id="calExpected" maxlength="80" autocomplete="off" inputmode="decimal" placeholder="Importe o nombre exacto" required></label>
        <label class="cal-checkbox"><input id="calVerified" type="checkbox">Revisé el recorte y el texto es correcto</label>
        <button type="button" id="calSave">Guardar ejemplo · sin IA</button>
        <div class="cal-comparison"><label class="cal-checkbox"><input id="calConsent" type="checkbox">Autorizo 2 consultas con consumo de créditos de IA</label>
          <button type="button" id="calCompare">Comparar · 2 consultas de IA</button></div>
        <div id="calResult" aria-live="polite"></div>
      </section></div><p id="calStatus" role="status"></p>
      <section class="cal-memory"><div class="cal-section-head"><h3>Ejemplos de esta persona</h3><span id="calCount"></span></div><div id="calExamples"></div></section>
      <section class="cal-history"><h3>Comparaciones recientes</h3><div id="calStats"></div><div id="calRuns"></div></section></div>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => button.focus());
    $('calChoose').onclick = () => $('calFile').click();
    $('calFile').onchange = async e => { if (e.target.files[0]) await loadPhoto(e.target.files[0]); };
    $('calSave').onclick = save;
    $('calCompare').onclick = compare;
    dialog.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => { resetSelection(); cropper?.zoom(Number(b.dataset.zoom)); });
    $('calRotate').onclick = () => { resetSelection(); cropper?.rotate(-90); };
    dialog.querySelectorAll('[data-coordinate]').forEach(input => input.onchange = () => {
      if (cropper && Number.isFinite(input.valueAsNumber)) { resetSelection(); cropper.setData({[input.dataset.coordinate]:input.valueAsNumber}); }
    });
    for (const id of ['calWriter','calDate','calKind','calExpected']) $(id).addEventListener('input', () => {
      resetSelection(); if (id === 'calWriter' || id === 'calKind') renderMemory();
      if (id === 'calKind') $('calExpected').inputMode = $('calKind').value === 'importe' ? 'decimal' : 'text';
    });
  }
  function resetSelection() {
    if (busy) return;
    sampleId = null; runId = null;
    $('calVerified').checked = false; $('calConsent').checked = false;
    $('calCompare').textContent = 'Comparar · 2 consultas de IA';
  }
  async function refresh() {
    const data = await api('GET'); examples = data.examples; runs = data.runs;
    $('calWriters').innerHTML = Array.from(new Set(['Vale','Ani','Marta','Luis',...examples.map(e => e.writer)])).map(w => `<option value="${esc(w)}"></option>`).join('');
    renderMemory();
  }
  function renderMemory() {
    const person = Caligrafia.writerKey($('calWriter').value);
    const list = examples.filter(e => Caligrafia.writerKey(e.writer) === person);
    $('calCount').textContent = `${list.length} recortes`;
    $('calExamples').innerHTML = list.map(e => `<div class="cal-example"><img src="data:image/jpeg;base64,${e.image}" alt="Ejemplo verificado"><div><b>${esc(e.expected)}</b><small>${esc(e.date)} · ${e.kind === 'importe' ? 'Importe' : 'Nombre'}</small></div><button type="button" class="cal-tool" data-delete="${e.id}" title="Eliminar ejemplo" aria-label="Eliminar ejemplo ${esc(e.expected)}">${icon('trash-2')}</button></div>`).join('') || '<p class="cal-muted">Sin ejemplos guardados para esta persona.</p>';
    $('calExamples').querySelectorAll('[data-delete]').forEach(b => b.onclick = () => remove(b.dataset.delete));
    const s = Caligrafia.stats(runs, $('calWriter').value);
    $('calStats').textContent = s.total ? `${s.total} recortes distintos · ${s.days} días · Sin ejemplos: ${s.baseline}/${s.total} · Con ejemplos: ${s.memory}/${s.total}` : 'Sin comparaciones completas para esta persona.';
    $('calRuns').innerHTML = runs.filter(r => Caligrafia.writerKey(r.writer) === person).map(r => `<div class="cal-run"><span>${esc(r.date)} · ${esc(r.expected)}</span><span>${r.state === 'complete' ? `Sin ejemplos: ${r.baseline.correct ? 'acierto' : 'error'} · Con ejemplos: ${r.memory.correct ? 'acierto' : 'error'}` : esc(r.state === 'running' ? 'Resultado pendiente' : 'Prueba incompleta')}</span><button type="button" data-run="${r.id}">Ver resultado</button></div>`).join('');
    $('calRuns').querySelectorAll('[data-run]').forEach(b => b.onclick = () => { showResult(runs.find(r => r.id === b.dataset.run)); });
  }
  async function loadPhoto(file) {
    if (busy) return;
    const sequence = ++cropSequence;
    lock(true); status('Abriendo foto…');
    try {
      const data = await cmComprimirFoto(file);
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      if (sequence !== cropSequence) return;
      sourceHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
      currentFile = file; cropper?.destroy(); cropper = null;
      $('calPhoto').src = `data:${data.mime};base64,${data.image}`;
      $('calPhoto').hidden = false; $('calEmpty').hidden = true;
      $('calFilename').textContent = file.name;
      await $('calPhoto').decode();
      cropper = new Cropper($('calPhoto'), {viewMode:1, autoCropArea:.18, preview:'.cal-preview', background:false,
        checkOrientation:false, toggleDragModeOnDblclick:false, minContainerWidth:200, minContainerHeight:240,
        crop(event) {
          dialog.querySelectorAll('[data-coordinate]').forEach(el => { if (document.activeElement !== el) el.value = Math.round(event.detail[el.dataset.coordinate]); });
        }, cropstart:resetSelection, zoom:resetSelection});
      status('Foto lista.');
    } catch (e) { sourceHash = null; status(e.message, true); }
    finally { lock(false); resetSelection(); }
  }
  function target() {
    if (!cropper || !sourceHash) throw Error('Falta seleccionar una foto.');
    if (!$('calWriter').value.trim()) throw Error('Indicá quién escribió este recorte.');
    if (!$('calDate').value) throw Error('Falta la fecha de la hoja.');
    if (!$('calVerified').checked) throw Error('Revisá la transcripción y marcala como verificada.');
    if (Caligrafia.text($('calExpected').value, $('calKind').value) === null) throw Error('Revisá el texto correcto del recorte.');
    let canvas = cropper.getCroppedCanvas({maxWidth:720,maxHeight:360,fillColor:'#fff',imageSmoothingQuality:'high'});
    if (!canvas || canvas.width < 16 || canvas.height < 16) throw Error('El recorte es demasiado chico.');
    const image = canvas.toDataURL('image/jpeg', .85).split(',')[1];
    if (image.length > 100000) throw Error('Seleccioná un recorte más pequeño.');
    return {writer:$('calWriter').value.trim(),date:$('calDate').value,kind:$('calKind').value,expected:$('calExpected').value.trim(),image,sourceHash};
  }
  async function save() {
    if (busy) return;
    try {
      const data = target(); sampleId ||= crypto.randomUUID();
      lock(true); status('Guardando ejemplo privado…');
      const saved = await api('POST', {...data,id:sampleId,action:'save'}); sampleId = saved.example.id; await refresh();
      status('Ejemplo guardado. No se consultó a la IA.');
    } catch (e) { status(e.message, true); }
    finally { lock(false); }
  }
  async function remove(id) {
    if (busy || !confirm('¿Eliminar este ejemplo de caligrafía?')) return;
    lock(true);
    try { await api('DELETE', {id}); await refresh(); status('Ejemplo eliminado.'); }
    catch (e) { status(e.message, true); }
    finally { lock(false); }
  }
  function showResult(r) {
    if (!r) { status('No se encontró esa prueba. No se hizo una nueva consulta de IA.', true); return; }
    const part = (label, result) => `<div class="cal-result-item"><span>${label}</span><strong>${esc(result?.text ?? 'Sin lectura')}</strong><small>${result ? (result.correct ? 'Coincide' : 'No coincide') : 'Pendiente'}</small></div>`;
    $('calResult').innerHTML = `<h3>${r.state === 'complete' ? 'Resultado' : 'Prueba incompleta'}</h3><small>${esc(r.writer)} · ${esc(r.date)}</small><p>Correcto: <b>${esc(r.expected)}</b></p>${part('Sin ejemplos',r.baseline)}${part('Con ejemplos',r.memory)}
      <small>${r.exampleIds.length} ejemplo(s) de otra fecha · ${[r.baseline,r.memory].reduce((s,v) => s+(v?.usage?.input||0)+(v?.usage?.output||0),0)} tokens informados</small>
      ${r.error || r.warning ? `<p class="error">${esc(r.error || r.warning)}</p>` : ''}`;
    status(r.state === 'complete' ? 'Comparación terminada. La lectura habitual no cambió.' : 'No se repetirá la consulta automáticamente. Podés consultar el resultado sin cargo.', r.state !== 'complete');
  }
  async function compare() {
    if (busy) return;
    try {
      if (runId) {
        lock(true); status('Consultando el resultado guardado…');
        showResult((await api('GET', null, '?run='+runId)).run); return;
      }
      const data = target();
      if (!$('calConsent').checked) throw Error('Falta autorizar las dos consultas de IA.');
      if (!Caligrafia.selectExamples(examples,data).length) throw Error('Primero guardá un ejemplo del mismo tipo y de esa persona, en una hoja de otro día.');
      runId = crypto.randomUUID(); lock(true); status('Comparando sin ejemplos y con ejemplos…');
      const response = await api('POST', {...data,id:runId,action:'compare',consent:true});
      showResult(response.run);
      await refresh().catch(() => {});
    } catch (e) { status(e.message + (runId ? ' Podés consultar el resultado sin volver a pagar.' : ''), true); }
    finally { lock(false); }
  }
  button.onclick = async () => {
    button.disabled = true;
    try {
      await loadDependencies(); if (!dialog) build();
      if (!dialog.open) dialog.showModal();
      if (!busy) {
        if (!$('calDate').value || (selectedFile && currentFile !== selectedFile)) $('calDate').value = typeof cmFotoData !== 'undefined' && cmFotoData?.fecha || (typeof cmFechaObjetivo !== 'undefined' ? cmFechaObjetivo : fechaHoy());
        if (selectedFile && currentFile !== selectedFile) await loadPhoto(selectedFile);
        lock(true); await refresh(); lock(false);
      }
    } catch (e) { if (dialog) {lock(false);status(e.message,true);} else showToast(e.message); }
    finally { button.disabled = false; }
  };
})();
