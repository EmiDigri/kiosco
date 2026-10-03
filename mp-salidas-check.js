// TEMPORAL (Claude, pedido de digra 3/10/2026): panel para ver qué manda Mercado Pago de
// cada transferencia enviada y encontrar a quién se le pagó. Solo aparece con
// ?mp_salidas_check=1, usa el login normal de la app y solo lee. BORRAR después de usar.
(() => {
  if (new URLSearchParams(location.search).get('mp_salidas_check') !== '1') return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const hoy = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Argentina/Buenos_Aires'}).format(new Date());
  const pista = /name|holder|nickname|bank|description|title|alias|cvu|cbu|collector|account|statement|reason|concept/i;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Consulta temporal de transferencias enviadas');
  dialog.style.cssText = 'width:min(960px,94vw);max-height:88vh;overflow:auto;padding:22px;background:#242426;color:#eee;border:1px solid #555;border-radius:10px;font:14px/1.45 Inter,sans-serif';
  dialog.innerHTML = `<form style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <h2 style="margin:0 12px 0 0;font-size:18px">Transferencias enviadas: ¿a quién?</h2>
      <input type="date" id="mpSalFecha" value="${hoy}" style="background:#181819;color:#fff;border:1px solid #555;border-radius:8px;padding:6px 10px">
      <button type="submit" style="padding:7px 14px;border-radius:8px;border:0;background:#8b7bff;color:#fff;font-weight:700">Consultar</button>
      <button type="button" id="mpSalCerrar" style="padding:7px 14px;border-radius:8px;border:1px solid #555;background:none;color:#eee">Cerrar</button>
    </form>
    <div id="mpSalRes" role="status" style="margin-top:16px"></div>`;
  document.body.append(dialog);
  const salida = dialog.querySelector('#mpSalRes');
  dialog.querySelector('#mpSalCerrar').onclick = () => dialog.close();
  const consultar = async () => {
    const boton = dialog.querySelector('[type="submit"]'), fecha = dialog.querySelector('#mpSalFecha').value;
    boton.disabled = true;
    salida.textContent = 'Consultando a Mercado Pago…';
    try {
      const r = await fetch(`/api/mp-history?salidas=${encodeURIComponent(fecha)}`, {headers: await window.kioscoAuth.headers(), cache: 'no-store'});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (!data.salidas.length) { salida.textContent = 'Ese día no hay transferencias enviadas.'; return; }
      salida.innerHTML = data.salidas.map(s => {
        const campos = s.campos.slice().sort((a, b) => Number(pista.test(b[0])) - Number(pista.test(a[0])));
        return `<section style="margin-bottom:18px;padding:12px 14px;border:1px solid #444;border-radius:10px;background:#1c1c1f">
          <div style="font-size:16px;font-weight:800;margin-bottom:8px">${esc(s.hora)} · -$${Number(s.monto).toLocaleString('es-AR')} <span style="font-weight:500;color:#aaa">· ${esc(s.operation_type)} ${s.description ? '· ' + esc(s.description) : ''}</span></div>
          <table style="width:100%;border-collapse:collapse;font:12.5px/1.4 ui-monospace,Consolas,monospace">${campos.map(([ruta, valor]) =>
            `<tr style="${pista.test(ruta) ? 'background:rgba(251,191,36,.12)' : ''}"><td style="padding:3px 8px;color:#9aa;vertical-align:top;white-space:nowrap">${esc(ruta)}</td><td style="padding:3px 8px;overflow-wrap:anywhere">${esc(valor)}</td></tr>`).join('')}</table>
        </section>`;
      }).join('');
    } catch (e) {
      salida.textContent = e.message;
    } finally {
      boton.disabled = false;
    }
  };
  dialog.querySelector('form').onsubmit = e => { e.preventDefault(); consultar(); };
  dialog.showModal();
})();
