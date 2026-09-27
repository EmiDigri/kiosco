(function() {
  'use strict';
  const button = document.getElementById('histDiaGastos');
  if (!button) return;
  const value = button.querySelector('strong');
  const state = button.querySelector('small');
  let request = 0;
  let draft = null;
  const addButton = document.createElement('button');
  addButton.id = 'histAgregarGasto';
  addButton.type = 'button';
  addButton.className = 'hist-gasto-agregar';
  addButton.innerHTML = '<span aria-hidden="true">+</span> Agregar gasto';
  addButton.setAttribute('aria-expanded', 'false');
  addButton.setAttribute('aria-controls', 'histNuevoGasto');
  addButton.disabled = true;
  const actions = document.createElement('div');
  actions.className = 'hist-dia-acciones';
  button.before(actions);
  actions.append(button, addButton);
  // El día abierto sale de la propia llamada a mostrarDetalleDia. No depende de que
  // index.html marque la vista con data-dia: eso solo existía en un cambio sin subir
  // y en producción el botón no hacía nada.
  let diaAbierto = '';
  const renderDia = window.mostrarDetalleDia;
  if (typeof renderDia === 'function') {
    window.mostrarDetalleDia = function(dia) {
      diaAbierto = String(dia || '');
      return renderDia.apply(this, arguments);
    };
  }
  function fechaVisible() {
    return diaAbierto || document.getElementById('histVistaDetalle')?.dataset.dia || '';
  }
  function cerrarAlta() {
    document.getElementById('histNuevoGasto')?.remove();
    draft = null;
    addButton.setAttribute('aria-expanded', 'false');
  }
  addButton.addEventListener('click', () => {
    const section = document.getElementById('histGastosDiaDetalle');
    const dia = fechaVisible();
    if (!section || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    section.open = true;
    if (document.getElementById('histNuevoGasto')) {
      document.getElementById('histGastoNuevoNombre').focus();
      return;
    }
    const current = {uid:cmUid(), fecha:dia, request, saving:false};
    draft = current;
    const form = document.createElement('form');
    form.id = 'histNuevoGasto';
    form.className = 'hist-nuevo-gasto';
    form.noValidate = true;
    const fecha = dia.split('-').reverse().join('/');
    form.innerHTML = `<h4>Agregar gasto <span>${fecha}</span></h4>
      <div class="hist-nuevo-campos">
        <label>Concepto<input id="histGastoNuevoNombre" name="concepto" type="text" maxlength="200" autocomplete="off" required></label>
        <label>Importe ($)<input id="histGastoNuevoMonto" name="monto" type="number" inputmode="decimal" min="0.01" step="0.01" required></label>
      </div>
      <p class="hist-nuevo-error" role="alert" hidden></p>
      <div class="hist-nuevo-acciones"><button type="button" class="hist-nuevo-cancelar">Cancelar</button><button type="submit" class="hist-nuevo-guardar">Guardar gasto</button></div>`;
    section.querySelector('summary').after(form);
    const nombreInput = form.elements.concepto;
    const montoInput = form.elements.monto;
    const error = form.querySelector('[role="alert"]');
    const submit = form.querySelector('[type="submit"]');
    form.addEventListener('input', () => { error.hidden = true; });
    const cancel = () => {
      if (current.saving) return;
      cerrarAlta();
      addButton.focus();
    };
    form.querySelector('.hist-nuevo-cancelar').addEventListener('click', cancel);
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (current.saving || draft !== current) return;
      const nombre = nombreInput.value.trim();
      const monto = montoInput.valueAsNumber;
      if (!nombre || nombre.length > 200 || !Number.isFinite(monto) || monto <= 0 || !montoInput.checkValidity()) {
        error.textContent = 'Ingresá un concepto y un importe mayor a cero, con hasta dos decimales.';
        error.hidden = false;
        (!nombre ? nombreInput : montoInput).focus();
        return;
      }
      current.saving = true;
      error.hidden = true;
      form.setAttribute('aria-busy', 'true');
      form.querySelectorAll('input,button').forEach(el => el.disabled = true);
      submit.textContent = 'Guardando...';
      try {
        // Keep the same uid on retry and the captured date, even if the user changes days.
        await cmGuardarGastoRemoto({uid:current.uid, nombre, monto, caja:'', turno:''}, current.fecha);
      } catch (err) {
        current.saving = false;
        form.removeAttribute('aria-busy');
        form.querySelectorAll('input,button').forEach(el => el.disabled = false);
        submit.textContent = 'Guardar gasto';
        error.textContent = 'No se pudo confirmar el guardado. Revisá la conexión y volvé a intentar.';
        error.hidden = false;
        return;
      }
      showToast(`Gasto guardado · ${fecha}`);
      if (draft === current && request === current.request && fechaVisible() === current.fecha) {
        cerrarAlta();
        if (typeof window.mostrarDetalleDia === 'function') await window.mostrarDetalleDia(current.fecha);
      }
    });
    addButton.setAttribute('aria-expanded', 'true');
    nombreInput.focus();
  });
  button.addEventListener('click', () => {
    const section = document.getElementById('histGastosDiaDetalle');
    if (!section) return;
    section.open = true;
    section.querySelector('summary').focus({preventScroll:true});
    section.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  });
  // Edición inline de un gasto del cuaderno desde el detalle del día (el ✎ de cada
  // renglón). Solo los gastos con uid (origen cuaderno) se pueden editar; las salidas
  // de MP no son gastos_caja. Guarda por uid (upsert) preservando caja/turno y refresca
  // el detalle. Usa funciones globales de index.html (cmGuardarGastoRemoto, showToast,
  // mostrarDetalleDia, cmEsc, histMoney).
  function wireGastoEdit(root) {
    if (!root) return;
    root.querySelectorAll('.hist-gasto-edit').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); abrirEdicionGasto(btn); });
    });
    root.querySelectorAll('.hist-gasto-del').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); borrarGasto(btn); });
    });
  }
  function borrarGasto(btn) {
    const uid = btn.dataset.guid, nombre = btn.dataset.nombre || '';
    if (!uid) return;
    if (!confirm(`¿Borrar el gasto "${nombre || 'sin nombre'}"? No se puede deshacer.`)) return;
    const dia = btn.dataset.fecha || fechaVisible();
    const row = btn.closest('.hist-gasto-line');
    if (row) { row.style.opacity = '.5'; row.querySelectorAll('button').forEach(b => b.disabled = true); }
    cmEliminarGastoRemoto({uid}).then(() => {
      showToast('Gasto borrado ✓');
      if (dia && typeof window.mostrarDetalleDia === 'function') window.mostrarDetalleDia(dia);
    }).catch(() => {
      showToast('No se pudo borrar. Probá de nuevo.');
      if (row) { row.style.opacity = ''; row.querySelectorAll('button').forEach(b => b.disabled = false); }
    });
  }
  function abrirEdicionGasto(btn) {
    const row = btn.closest('.hist-gasto-line');
    if (!row) return;
    const datos = {uid:btn.dataset.guid, nombre:btn.dataset.nombre || '', monto:Number(btn.dataset.monto) || 0, caja:btn.dataset.caja || '', turno:btn.dataset.turno || '', fecha:btn.dataset.fecha || ''};
    const original = row.innerHTML;
    row.classList.add('editando');
    row.innerHTML = `<input class="hist-gasto-enom" type="text" value="${cmEsc(datos.nombre)}" aria-label="Concepto" placeholder="Concepto"><input class="hist-gasto-emon" type="number" inputmode="numeric" value="${datos.monto}" aria-label="Monto" placeholder="Monto"><button class="hist-gasto-ok" title="Guardar" aria-label="Guardar">✓</button><button class="hist-gasto-no" title="Cancelar" aria-label="Cancelar">✕</button>`;
    const nom = row.querySelector('.hist-gasto-enom'), mon = row.querySelector('.hist-gasto-emon');
    nom.focus(); nom.select();
    const cancelar = () => { row.classList.remove('editando'); row.innerHTML = original; wireGastoEdit(row); };
    const guardar = async () => {
      const nombre = nom.value.trim(), monto = Number(mon.value) || 0;
      if (!nombre || !monto) { showToast('Cargá concepto y monto'); return; }
      // La fecha sale del propio gasto: sin ella la base rechazaba el guardado.
      const dia = datos.fecha || fechaVisible();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { showToast('No encontré la fecha de este gasto. Recargá la página.'); return; }
      row.querySelectorAll('input,button').forEach(el => el.disabled = true);
      try {
        await cmGuardarGastoRemoto({uid:datos.uid, nombre, monto, caja:datos.caja, turno:datos.turno}, dia);
        showToast('Gasto editado ✓');
        if (dia && typeof window.mostrarDetalleDia === 'function') window.mostrarDetalleDia(dia);
      } catch (err) {
        showToast('No se pudo guardar. Probá de nuevo.');
        row.querySelectorAll('input,button').forEach(el => el.disabled = false);
      }
    };
    row.querySelector('.hist-gasto-ok').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); guardar(); });
    row.querySelector('.hist-gasto-no').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cancelar(); });
    [nom, mon].forEach(el => el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); guardar(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
    }));
  }
  window.HistorialGastos = {
    cargando() {
      cerrarAlta();
      addButton.disabled = true;
      button.disabled = true;
      value.textContent = '...';
      state.textContent = '';
      state.hidden = true;
      button.setAttribute('aria-label', 'Cargando gastos del día');
      return ++request;
    },
    vigente(id) { return id === request; },
    render(gastos, pagos, remoto) {
      const data = CierreCuentas.resumenGastosDia(gastos, pagos, remoto);
      const amount = data.porRevisar ? 'Por revisar' : histMoney(data.total);
      value.textContent = amount;
      state.textContent = data.local ? 'Respaldo local' : '';
      state.hidden = !data.local;
      button.disabled = false;
      button.setAttribute('aria-label', `Gastos del día: ${amount}. Ver detalle${data.local ? '. Respaldo local' : ''}`);
      const summaryTotal = document.querySelector('[data-hist-gasto-total]');
      if (summaryTotal) summaryTotal.textContent = amount;
      const container = document.getElementById('histTurnosDetalle');
      const previous = Array.from(container.children).find(el =>
        el.dataset.histSection === 'gastos' || el.querySelector('.hist-cierre-title')?.textContent.trim() === 'Gastos del día');
      const section = document.createElement('details');
      section.id = 'histGastosDiaDetalle';
      section.className = 'hist-cierre-block hist-gastos-detalle';
      section.dataset.histSection = 'gastos';
      section.dataset.defaultOpen = 'true';
      section.open = previous?.tagName === 'DETAILS' ? previous.open : true;
      const note = data.porRevisar ? 'Hay gastos y salidas de MP del mismo importe que necesitan revisión. El total queda pendiente para evitar contarlos dos veces.' : '';
      const local = data.local ? 'Respaldo local: pueden faltar movimientos de otros equipos.' : '';
      section.innerHTML = `<summary><span>Gastos del día</span><span class="hist-gastos-importe">${cmEsc(amount)}</span></summary>
        ${note || local ? `<p class="hist-gastos-nota">${cmEsc([note, local].filter(Boolean).join(' '))}</p>` : ''}
        ${data.filas.length ? data.filas.map(g => {
          const anotado = g.anotado != null ? ` · anotado ${histMoney(g.anotado)}` : '';
          const medio = g.medio === 'revisar' ? 'Medio de pago por revisar' : g.medio === 'mp' ? 'MP' + anotado : data.local ? 'Medio de pago sin verificar' : 'Efectivo';
          const nombreGasto = CierreCuentas.conceptoGasto(g.nombre || 'Transferencia enviada');
          const logo = typeof provLogoHtml === 'function' ? provLogoHtml(nombreGasto) : '';
          const concepto = `<span>${logo}${cmEsc(nombreGasto)}${g.caja ? ' · ' + cmEsc(g.caja) : ''}<small class="hist-gasto-meta">${medio}</small></span>`;
          // Solo los gastos del cuaderno (con uid) se editan; las salidas de MP no.
          if (g.origen === 'cuaderno' && g.uid) {
            const editBtn = `<button class="hist-gasto-edit" data-guid="${cmEsc(g.uid)}" data-nombre="${cmEsc(g.nombre || '')}" data-monto="${Number(g.anotado ?? g.monto) || 0}" data-caja="${cmEsc(g.caja || '')}" data-turno="${cmEsc(g.turno || '')}" data-fecha="${cmEsc(g.fecha || '')}" title="Editar" aria-label="Editar gasto">✎</button>`;
            const delBtn = `<button class="hist-gasto-del" data-guid="${cmEsc(g.uid)}" data-nombre="${cmEsc(g.nombre || '')}" data-fecha="${cmEsc(g.fecha || '')}" title="Borrar" aria-label="Borrar gasto">✕</button>`;
            return `<div class="hist-gasto-line">${concepto}<span class="hist-gasto-r"><strong>${histMoney(g.monto)}</strong>${editBtn}${delBtn}</span></div>`;
          }
          return `<div class="hist-gasto-line">${concepto}<strong>${histMoney(g.monto)}</strong></div>`;
        }).join('') : '<p class="hist-gastos-nota">Sin gastos registrados para este día.</p>'}`;
      if (previous) previous.replaceWith(section);
      else container.prepend(section);
      wireGastoEdit(section);
      addButton.disabled = false;
    }
  };
})();
