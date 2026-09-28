(() => {
  if (new URLSearchParams(location.search).get('mp_names_check') !== '1') return;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Consulta temporal MP');
  dialog.style.cssText = 'width:min(900px,92vw);max-height:85vh;overflow:auto;padding:24px;background:#242426;color:#eee;border:1px solid #555;border-radius:8px';
  dialog.innerHTML = `<form>
    <h2>Consulta temporal MP</h2>
    <label for="mpProbeIds">Operaciones</label>
    <textarea id="mpProbeIds" rows="3" required style="display:block;width:100%;box-sizing:border-box;margin:12px 0;background:#181819;color:#fff;padding:12px"></textarea>
    <button type="submit">Consultar</button>
    <button type="button" id="mpProbeClose">Cerrar</button>
    <pre id="mpProbeResult" role="status" style="white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 monospace"></pre>
  </form>`;
  document.body.append(dialog);
  dialog.querySelector('#mpProbeClose').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector('[type="submit"]');
    const output = dialog.querySelector('#mpProbeResult');
    const ids = dialog.querySelector('textarea').value.trim().split(/[\s,;]+/).join(',');
    if (!/^\d{1,20}(,\d{1,20}){0,9}$/.test(ids)) {
      output.textContent = 'Ingresar entre 1 y 10 operaciones numericas.';
      return;
    }
    button.disabled = true;
    output.textContent = 'Consultando...';
    try {
      const response = await fetch(`/api/mp-history?payment_ids=${encodeURIComponent(ids)}`, {
        headers: await window.kioscoAuth.headers(), cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      output.textContent = data.results.map(row => {
        if (row.http_status !== 200) return `${row.id}: HTTP ${row.http_status}`;
        return `${row.id} | $${row.amount} | ${row.date}\nTipo: ${row.operation_type} / ${row.payment_type}\nIdentificador de pagador: ${row.has_payer_id ? 'presente' : 'ausente'}\nNombre principal: ${row.names.payer || '(vacio)'}\nNombre adicional: ${row.names.additional || '(vacio)'}\nTitular tarjeta: ${row.names.cardholder || '(vacio)'}`;
      }).join('\n\n');
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; }
  };
  dialog.showModal();
})();
