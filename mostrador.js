(function () {
  'use strict';
  window.KioscoMostrador = function (api) {
    const $ = id => document.getElementById(id);
    const overlay = $('mostradorOverlay'), scan = $('mostradorScan');
    if (!overlay || !scan) return () => {};
    const list = $('mostradorList'), status = $('mostradorStatus'), confirm = $('mostradorCobrar');
    const quick = $('mostradorAlta'), payment = $('mostradorPago');
    const KEY = 'kiosco_mostrador_borradores_v3';
    const empty = () => ({ id: crypto.randomUUID(), items: [], submitted: false, medio_pago: 'efectivo' });
    let drafts = readDrafts(), mode = 'venta', busy = false, unknown = '', newUid = '';
    let consulted = null, history = [], historyLoaded = false, previousFocus = null, bodyOverflow = '';
    let audio = null, scanQueue = Promise.resolve();
    function readDrafts() {
      try { const d = JSON.parse(localStorage.getItem(KEY)); if (d?.venta?.items && d?.entrada?.items) return d; } catch {}
      return { venta: empty(), entrada: empty() };
    }
    const draft = () => drafts[mode];
    const locked = () => busy || !!api.pending() || !!draft()?.submitted;
    function say(text, bad = false) { status.textContent = text; status.classList.toggle('error', bad); }
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(drafts)); return true; }
      catch { say('No se pudo guardar el carrito en este equipo. No se enviaron cambios.', true); return false; }
    }
    if (!api.pending()) {
      Object.values(drafts).forEach(d => { d.submitted = false; });
      persist();
    }
    function beep(ok) {
      try {
        audio ||= new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.connect(gain); gain.connect(audio.destination);
        oscillator.frequency.value = ok ? 880 : 200;
        gain.gain.setValueAtTime(0.035, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
        oscillator.start(); oscillator.stop(audio.currentTime + 0.13);
      } catch {}
    }
    function flash() {
      const el = $('mostradorFlash'); el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    }
    function focusScan() { if (overlay.classList.contains('open') && quick.hidden && mode !== 'tickets') scan.focus(); }
    function productLine(item) {
      const product = api.items().find(p => p.uid === item.uid);
      const qty = item.cantidad;
      return { ...item, qty, product };
    }
    function render() {
      const selling = mode === 'venta', receiving = mode === 'entrada';
      document.querySelectorAll('[data-most-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mostMode === mode);
        b.setAttribute('aria-selected', String(b.dataset.mostMode === mode));
      });
      scan.hidden = mode === 'tickets';
      $('mostradorFoot').hidden = (!selling && !receiving) || !quick.hidden;
      list.hidden = !quick.hidden;
      $('mostradorPayment').hidden = !selling;
      $('mostradorTotalLabel').textContent = selling ? 'Total a registrar' : 'Costo de la entrada';
      if (selling) payment.value = draft().medio_pago;
      if (selling || receiving) {
        const lines = draft().items.map(productLine);
        list.innerHTML = lines.length ? lines.map(item => {
          const unitPrice = selling ? item.precio : item.costo;
          const p = item.product;
          const uid = api.escapeHtml(item.uid);
          return `<div class="mostrador-item">
            <div class="mostrador-item-info"><div class="mostrador-item-name">${api.escapeHtml(p?.nombre || item.nombre)}</div>
              <div class="mostrador-item-price">${api.money(unitPrice)} c/u &middot; ${p?.stock == null ? 'Sin control de stock' : `Stock: ${p.stock}`}</div>
              ${receiving ? `<label class="mostrador-cost">Costo unitario <input data-cost="${uid}" type="number" min="0" step="0.01" value="${item.costo}" ${locked() ? 'disabled' : ''}></label>` : ''}
            </div>
            <div class="mostrador-qty"><button type="button" data-minus="${uid}" aria-label="Restar" ${locked() ? 'disabled' : ''}>&minus;</button><span>${item.cantidad}</span><button type="button" data-plus="${uid}" aria-label="Sumar" ${locked() ? 'disabled' : ''}>+</button></div>
            <div class="mostrador-item-sub">${api.money(unitPrice * item.qty)}</div>
            <button class="mostrador-item-del" type="button" data-remove="${uid}" aria-label="Quitar ${api.escapeHtml(item.nombre)}" ${locked() ? 'disabled' : ''}>&times;</button></div>`;
        }).join('') : '<div class="mostrador-empty">Carrito vac&iacute;o</div>';
        $('mostradorTotal').textContent = api.money(lines.reduce((sum, item) => sum + (selling ? item.precio : item.costo) * item.qty, 0));
        confirm.disabled = locked() || !lines.length;
        confirm.textContent = busy ? 'Confirmando...' : selling ? 'Registrar venta' : 'Confirmar entrada';
        $('mostradorVaciar').disabled = locked() || !lines.length;
        $('mostradorActualizar').disabled = locked() || !lines.length;
        payment.disabled = locked();
      } else if (mode === 'consulta') {
        const p = consulted && api.items().find(p => p.uid === consulted);
        list.innerHTML = p ? `<div class="mostrador-consulta">${p.imagen && /^https:\/\//.test(p.imagen) ? `<img src="${api.escapeHtml(p.imagen)}" alt="" width="64" height="64">` : ''}
          <h3>${api.escapeHtml(p.nombre)}</h3><strong>${api.money(p.precio)}</strong>
          <dl><dt>Costo</dt><dd>${api.money(p.costo)}</dd><dt>Margen</dt><dd>${api.margin(p) == null ? 'Sin costo' : api.margin(p).toFixed(1) + '%'}</dd><dt>Stock</dt><dd>${p.stock == null ? 'Sin controlar' : p.stock}</dd></dl></div>` : '<div class="mostrador-empty">Consulta de precio</div>';
      } else renderHistory();
      document.querySelectorAll('[data-cat-retry]').forEach(b => { b.hidden = !api.pending(); });
    }
    async function loadHistory() {
      say('Cargando tickets...');
      try {
        history = await api.history(); historyLoaded = true;
        if (mode === 'tickets') { renderHistory(); say(''); }
      } catch (error) { say(error.message, true); }
    }
    function renderHistory() {
      const reversed = new Set(history.filter(o => o.tipo === 'anular').map(o => o.original_id));
      const sales = history.filter(o => o.tipo === 'venta');
      list.innerHTML = sales.length ? sales.map(o => {
        const r = o.resultado, date = new Date(o.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
        return `<details class="mostrador-ticket"><summary><span>${api.escapeHtml(date)}<small>${api.escapeHtml(r.medio_pago)} &middot; ${o.id.slice(0,8)}</small></span><strong>${api.money(r.total)}</strong></summary>
          ${r.lineas.map(l => `<p>${l.cantidad} &times; ${api.escapeHtml(l.nombre)} <strong>${api.money(l.precio * l.cantidad)}</strong></p>`).join('')}
          <button type="button" class="mostrador-btn-sec" data-void="${o.id}" ${reversed.has(o.id) || busy ? 'disabled' : ''}>${reversed.has(o.id) ? 'Anulada' : 'Anular registro y reponer stock'}</button></details>`;
      }).join('') : `<div class="mostrador-empty">${historyLoaded ? 'No hay ventas registradas' : 'Cargando tickets...'}</div>`;
    }
    function queueScan(code) {
      scanQueue = scanQueue.then(() => add(code)).catch(error => say(error.message, true));
    }
    async function add(code) {
      if (!/^[0-9]{6,20}$/.test(code)) { say('Revisa el codigo: entre 6 y 20 digitos.', true); return; }
      if (locked()) { say('Resolve la operacion pendiente antes de continuar.', true); return; }
      let product = api.find(code);
      if (!product) { await api.refresh(); product = api.find(code); }
      if (!product) {
        unknown = code; newUid = api.uid();
        quick.reset(); quick.hidden = false;
        $('mostradorNuevoCodigo').textContent = code;
        render(); say('Producto nuevo', true); beep(false); $('mostradorNombre').focus(); return;
      }
      quick.hidden = true;
      if (mode === 'consulta') { consulted = product.uid; render(); beep(true); return; }
      if (!draft()) return;
      const existing = draft().items.find(item => item.uid === product.uid);
      if (existing) existing.cantidad++;
      else draft().items.push({ uid: product.uid, nombre: product.nombre, cantidad: 1, precio: product.precio, costo: product.costo });
      persist(); render(); beep(true); flash();
      const item = draft().items.find(i => i.uid === product.uid);
      const short = mode === 'venta' && product.stock != null && product.stock < item.cantidad;
      say(short ? `Stock insuficiente de ${product.nombre}: ${product.stock} disponibles.` : `${product.nombre} agregado.`, short);
    }
    async function open(nextMode = 'venta') {
      if (!overlay.classList.contains('open')) {
        previousFocus = document.activeElement; bodyOverflow = document.body.style.overflow;
        overlay.inert = false; overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
      }
      if (busy) return;
      mode = nextMode; quick.hidden = true; render(); focusScan();
      if (mode === 'tickets') { await loadHistory(); return; }
      say(api.pending() ? 'Hay una operacion sin confirmar.' : 'Actualizando catalogo...');
      const fresh = await api.refresh();
      if (!api.pending()) say(fresh ? '' : 'Copia local. Se necesita conexion para confirmar.', !fresh);
      render();
    }
    function close() {
      overlay.inert = true; overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = bodyOverflow; previousFocus?.focus();
    }
    $('btnMostrador').addEventListener('click', () => open());
    $('mostradorClose').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.querySelectorAll('[data-most-mode]').forEach(b => b.addEventListener('click', () => open(b.dataset.mostMode)));
    scan.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); const code = scan.value.trim(); scan.value = ''; if (code) queueScan(code);
    });
    list.addEventListener('click', async event => {
      const b = event.target.closest('button'); if (!b || locked()) return;
      if (b.dataset.void) {
        if (!window.confirm('Anular este registro y reponer sus unidades al stock? Esto NO devuelve dinero en Mercado Pago.')) return;
        busy = true; render();
        try { await api.rpc('anular', { original: b.dataset.void }); await loadHistory(); say('Registro anulado. No se movio dinero.'); }
        catch (error) { say(error.message, true); }
        finally { busy = false; render(); }
        return;
      }
      const uid = b.dataset.plus || b.dataset.minus || b.dataset.remove;
      const item = draft()?.items.find(i => i.uid === uid); if (!item) return;
      if (b.dataset.plus) item.cantidad++;
      if (b.dataset.minus) item.cantidad--;
      if (b.dataset.remove || item.cantidad < 1) draft().items = draft().items.filter(i => i.uid !== uid);
      persist(); render(); focusScan();
    });
    list.addEventListener('change', event => {
      if (locked()) return;
      const input = event.target, uid = input.dataset.cost;
      const item = draft()?.items.find(i => i.uid === uid); if (!item) return;
      if (input.value !== '' && Number.isFinite(Number(input.value)) && Number(input.value) >= 0) item.costo = Number(input.value);
      persist(); render();
    });
    payment.addEventListener('change', () => { if (!locked()) { draft().medio_pago = payment.value; persist(); } });
    $('mostradorVaciar').addEventListener('click', () => {
      if (locked() || !window.confirm('Vaciar este carrito?')) return;
      drafts[mode] = empty(); persist(); render(); focusScan();
    });
    $('mostradorActualizar').addEventListener('click', async () => {
      if (locked()) return;
      busy = true; render();
      try {
        if (!await api.refresh()) { say('No se pudieron consultar los precios actuales.', true); return; }
        draft().items.forEach(item => { const p = api.items().find(p => p.uid === item.uid); if (p) { item.precio = p.precio; item.costo = p.costo; } });
        persist(); say('Precios del carrito actualizados. Revisa el total.');
      } finally { busy = false; render(); }
    });
    confirm.addEventListener('click', async () => {
      if (locked() || !draft()?.items.length) return;
      const currentMode = mode, current = draft();
      const items = current.items.map(productLine).map(i => mode === 'venta'
        ? { uid: i.uid, cantidad: i.qty, precio: i.precio }
        : { uid: i.uid, cantidad: i.qty, costo: i.costo });
      current.submitted = true;
      if (!persist()) { current.submitted = false; return; }
      busy = true; render(); say('Confirmando en el servidor...');
      try {
        const result = await api.rpc(currentMode, { items, ...(currentMode === 'venta' ? { medio_pago: current.medio_pago } : {}) }, false, current.id);
        say(`${currentMode === 'venta' ? 'Venta registrada' : 'Entrada registrada'}: ${api.money(result.total)}. Ticket ${result.id.slice(0,8)}.`);
        beep(true); flash();
      } catch (error) {
        if (!api.pending()) { current.submitted = false; persist(); }
        say(error.message, true);
      } finally { busy = false; render(); focusScan(); }
    });
    quick.addEventListener('submit', async event => {
      event.preventDefault(); if (locked()) return;
      busy = true; $('mostradorGuardarNuevo').disabled = true;
      const product = { uid: newUid, ean: unknown, nombre: $('mostradorNombre').value.trim(),
        categoria: $('mostradorCategoria').value.trim(), precio: Number($('mostradorPrecio').value), costo: Number($('mostradorCosto').value),
        stock: $('mostradorStock').value === '' ? null : Number($('mostradorStock').value), origen: 'mostrador' };
      try {
        await api.save(product); quick.hidden = true; busy = false; await add(unknown); focusScan();
      } catch (error) { say(error.message, true); }
      finally { busy = false; $('mostradorGuardarNuevo').disabled = false; render(); }
    });
    $('mostradorCancelarNuevo').addEventListener('click', () => { quick.hidden = true; render(); focusScan(); });
    window.addEventListener('kiosco:catalogo', () => { if (overlay.classList.contains('open')) render(); });
    window.addEventListener('kiosco:operacion', event => {
      const r = event.detail;
      if (drafts[r.tipo]?.id === r.id) { drafts[r.tipo] = empty(); persist(); }
      historyLoaded = false;
      render();
    });
    window.addEventListener('kiosco:operacion-rechazada', event => {
      const request = event.detail;
      if (drafts[request.p_tipo]?.id === request.p_id) { drafts[request.p_tipo].submitted = false; persist(); render(); }
    });
    window.addEventListener('storage', event => { if (event.key === KEY && !busy) { drafts = readDrafts(); render(); } });
    // A scanner is a fast keyboard burst. Consume Enter before a focused home
    // button can activate, but never intercept typing in a form or another dialog.
    let buffer = '', lastKey = 0;
    document.addEventListener('keydown', event => {
      if (overlay.classList.contains('open') && event.key === 'Escape') { close(); return; }
      if (overlay.classList.contains('open') && event.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      const el = document.activeElement;
      if (event.ctrlKey || event.altKey || event.metaKey || el?.matches('input,textarea,select') || el?.isContentEditable) { buffer = ''; return; }
      const now = Date.now(); if (now - lastKey > 100) buffer = ''; lastKey = now;
      if (event.key === 'Enter') {
        const code = buffer; buffer = '';
        const login = $('loginOverlay');
        if (!/^[0-9]{6,20}$/.test(code) || (login && !login.classList.contains('oculto'))) return;
        const otherDialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(dialog =>
          !overlay.contains(dialog) && !dialog.classList.contains('oculto') && dialog.getAttribute('aria-hidden') !== 'true'
          && dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden');
        if (!overlay.classList.contains('open') && (otherDialog || document.querySelector('.historial-overlay.open,.price-overlay.open'))) return;
        event.preventDefault(); event.stopPropagation();
        if (!overlay.classList.contains('open')) scanQueue = scanQueue.then(() => open('venta'));
        queueScan(code);
      } else if (/^[0-9]$/.test(event.key)) buffer += event.key;
      else buffer = '';
    });
    render();
    return open;
  };
})();
