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
  window.HistorialGastos = {
    cargando() {
      button.disabled = true;
      value.textContent = '...';
      state.textContent = '';
      state.hidden = true;
      button.setAttribute('aria-label', 'Cargando gastos del d\u00eda');
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
      button.setAttribute('aria-label', `Gastos del d\u00eda: ${amount}. Ver detalle${data.local ? '. Respaldo local' : ''}`);
      const summaryTotal = document.querySelector('[data-hist-gasto-total]');
      if (summaryTotal) summaryTotal.textContent = amount;
      const container = document.getElementById('histTurnosDetalle');
      const previous = Array.from(container.children).find(el =>
        el.dataset.histSection === 'gastos' || el.querySelector('.hist-cierre-title')?.textContent.trim() === 'Gastos del d\u00eda');
      const section = document.createElement('details');
      section.id = 'histGastosDiaDetalle';
      section.className = 'hist-cierre-block hist-gastos-detalle';
      section.dataset.histSection = 'gastos';
      section.dataset.defaultOpen = 'true';
      section.open = previous?.tagName === 'DETAILS' ? previous.open : true;
      const note = data.porRevisar ? 'Hay gastos y salidas de MP del mismo importe que necesitan revisi\u00f3n. El total queda pendiente para evitar contarlos dos veces.' : '';
      const local = data.local ? 'Respaldo local: pueden faltar movimientos de otros equipos.' : '';
      section.innerHTML = `<summary><span>Gastos del d\u00eda</span><span class="hist-gastos-importe">${cmEsc(amount)}</span></summary>
        ${note || local ? `<p class="hist-gastos-nota">${cmEsc([note, local].filter(Boolean).join(' '))}</p>` : ''}
        ${data.filas.length ? data.filas.map(g => {
          const medio = g.medio === 'revisar' ? 'Medio de pago por revisar' : g.medio === 'mp' ? 'MP' : data.local ? 'Medio de pago sin verificar' : 'Efectivo';
          return `<div class="hist-gasto-line"><span>${cmEsc(g.nombre || 'Transferencia enviada')}${g.caja ? ' \u00b7 ' + cmEsc(g.caja) : ''}<small class="hist-gasto-meta">${medio}</small></span><strong>${histMoney(g.monto)}</strong></div>`;
        }).join('') : '<p class="hist-gastos-nota">Sin gastos registrados para este d\u00eda.</p>'}`;
      if (previous) previous.replaceWith(section);
      else container.prepend(section);
    }
  };
})();
