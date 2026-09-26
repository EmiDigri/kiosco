(function() {
  'use strict';
  const button = document.getElementById('histDiaGastos');
  if (!button) return;
  const value = button.querySelector('strong');
  const state = button.querySelector('small');
  let request = 0;
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
    const dia = document.getElementById('histVistaDetalle')?.dataset.dia || '';
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
    const datos = {uid:btn.dataset.guid, nombre:btn.dataset.nombre || '', monto:Number(btn.dataset.monto) || 0, caja:btn.dataset.caja || '', turno:btn.dataset.turno || ''};
    const original = row.innerHTML;
    row.classList.add('editando');
    row.innerHTML = `<input class="hist-gasto-enom" type="text" value="${cmEsc(datos.nombre)}" aria-label="Concepto" placeholder="Concepto"><input class="hist-gasto-emon" type="number" inputmode="numeric" value="${datos.monto}" aria-label="Monto" placeholder="Monto"><button class="hist-gasto-ok" title="Guardar" aria-label="Guardar">✓</button><button class="hist-gasto-no" title="Cancelar" aria-label="Cancelar">✕</button>`;
    const nom = row.querySelector('.hist-gasto-enom'), mon = row.querySelector('.hist-gasto-emon');
    nom.focus(); nom.select();
    const cancelar = () => { row.classList.remove('editando'); row.innerHTML = original; wireGastoEdit(row); };
    const guardar = async () => {
      const nombre = nom.value.trim(), monto = Number(mon.value) || 0;
      if (!nombre || !monto) { showToast('Cargá concepto y monto'); return; }
      const dia = document.getElementById('histVistaDetalle')?.dataset.dia || '';
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
          const medio = g.medio === 'revisar' ? 'Medio de pago por revisar' : g.medio === 'mp' ? 'MP' : data.local ? 'Medio de pago sin verificar' : 'Efectivo';
          const nombreGasto = CierreCuentas.conceptoGasto(g.nombre || 'Transferencia enviada');
          const logo = typeof provLogoHtml === 'function' ? provLogoHtml(nombreGasto) : '';
          const concepto = `<span>${logo}${cmEsc(nombreGasto)}${g.caja ? ' · ' + cmEsc(g.caja) : ''}<small class="hist-gasto-meta">${medio}</small></span>`;
          // Solo los gastos del cuaderno (con uid) se editan; las salidas de MP no.
          if (g.origen === 'cuaderno' && g.uid) {
            const editBtn = `<button class="hist-gasto-edit" data-guid="${cmEsc(g.uid)}" data-nombre="${cmEsc(g.nombre || '')}" data-monto="${Number(g.monto) || 0}" data-caja="${cmEsc(g.caja || '')}" data-turno="${cmEsc(g.turno || '')}" title="Editar" aria-label="Editar gasto">✎</button>`;
            const delBtn = `<button class="hist-gasto-del" data-guid="${cmEsc(g.uid)}" data-nombre="${cmEsc(g.nombre || '')}" title="Borrar" aria-label="Borrar gasto">✕</button>`;
            return `<div class="hist-gasto-line">${concepto}<span class="hist-gasto-r"><strong>${histMoney(g.monto)}</strong>${editBtn}${delBtn}</span></div>`;
          }
          return `<div class="hist-gasto-line">${concepto}<strong>${histMoney(g.monto)}</strong></div>`;
        }).join('') : '<p class="hist-gastos-nota">Sin gastos registrados para este día.</p>'}`;
      if (previous) previous.replaceWith(section);
      else container.prepend(section);
      wireGastoEdit(section);
    }
  };
})();
