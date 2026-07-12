(function initPriceReference() {
  const overlay = document.getElementById('priceOverlay');
  const openButton = document.getElementById('btnPrecios');
  const closeButton = document.getElementById('btnCerrarPrecios');
  const searchForm = document.getElementById('priceSearchForm');
  const searchInput = document.getElementById('priceSearchInput');
  const searchButton = document.getElementById('priceSearchButton');
  const resultsElement = document.getElementById('priceResults');
  const resultCount = document.getElementById('priceResultCount');
  const detailElement = document.getElementById('priceDetail');
  const locationPreset = document.getElementById('priceLocationPreset');
  const useLocationButton = document.getElementById('priceUseLocation');
  const panel = overlay?.querySelector('.price-panel');
  const priceHeader = overlay?.querySelector('.price-header');
  if (!overlay || !openButton || !searchForm) return;

  const API_URL = window.KIOSCO_CATALOG_API || '/api/catalogo';
  const PRICE_STORAGE_KEY = 'kiosco_product_prices_v1';
  const LOCATION_STORAGE_KEY = 'kiosco_product_location_v1';
  const LOCATIONS = {
    caba: { lat: -34.6037, lng: -58.3816, label: 'CABA centro' },
    'vicente-lopez': { lat: -34.5266, lng: -58.4804, label: 'Vicente López' },
    'san-martin': { lat: -34.5752, lng: -58.5371, label: 'San Martín' },
    avellaneda: { lat: -34.6611, lng: -58.3669, label: 'Avellaneda' },
    'la-plata': { lat: -34.9214, lng: -57.9544, label: 'La Plata' },
  };
  const state = {
    location: loadLocation(),
    items: [],
    selectedEan: null,
    detail: null,
    searchRequest: 0,
    detailRequest: 0,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    const decimals = Math.abs(number - Math.round(number)) > 0.005 ? 2 : 0;
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(number);
  }

  function percentage(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function numberInputValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(Math.round(number * 100) / 100) : '';
  }

  function notify(message) {
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function loadLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || 'null');
      if (Number.isFinite(saved?.lat) && Number.isFinite(saved?.lng)) return saved;
    } catch (error) {
      // Ignore malformed local preferences.
    }
    return { ...LOCATIONS.caba, key: 'caba' };
  }

  function saveLocation(location) {
    state.location = location;
    try {
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
    } catch (error) {
      // The search still works if local storage is unavailable.
    }
  }

  function syncLocationControl() {
    const key = state.location.key;
    if (key && LOCATIONS[key]) {
      locationPreset.value = key;
      return;
    }
    let custom = locationPreset.querySelector('option[value="current"]');
    if (!custom) {
      custom = document.createElement('option');
      custom.value = 'current';
      locationPreset.appendChild(custom);
    }
    custom.textContent = state.location.label || 'Mi ubicación';
    locationPreset.value = 'current';
  }

  function readSavedPrices() {
    try {
      const saved = JSON.parse(localStorage.getItem(PRICE_STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (error) {
      return {};
    }
  }

  function saveOwnPrice(ean, values) {
    const all = readSavedPrices();
    all[ean] = { ...values, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(all));
    } catch (error) {
      // Calculations remain visible even if persistence is blocked.
    }
  }

  function setOpen(open) {
    overlay.classList.toggle('open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      if (typeof window.lockBody === 'function') window.lockBody();
      if (panel) panel.scrollTop = 0;
      setTimeout(() => searchInput.focus(), 40);
    } else if (typeof window.unlockBody === 'function') {
      window.unlockBody();
    }
  }

  function loadingHtml(label) {
    return `<div class="price-empty"><div class="price-spinner"></div><span>${escapeHtml(label)}</span></div>`;
  }

  function errorHtml(message) {
    return `<div class="price-error">${escapeHtml(message)}</div>`;
  }

  function itemPriceSummary(item) {
    const retail = item.retail?.min;
    const wholesale = item.wholesale?.unitWithVatMin;
    const parts = [];
    if (retail) parts.push(`<span>Minor. <strong>${money(retail)}</strong></span>`);
    if (wholesale) parts.push(`<span>Mayor. <strong>${money(wholesale)}</strong></span>`);
    return parts.length ? parts.join('') : '<span>Sin precios en esta zona</span>';
  }

  function renderResults() {
    resultCount.textContent = String(state.items.length);
    if (!state.items.length) {
      resultsElement.innerHTML = '<div class="price-empty"><div class="price-empty-icon">0</div><span>No encontramos una variante vigente en esta zona.</span></div>';
      return;
    }
    resultsElement.innerHTML = state.items.map(item => `
      <button class="price-result${item.ean === state.selectedEan ? ' active' : ''}" type="button" data-ean="${escapeHtml(item.ean)}" aria-pressed="${item.ean === state.selectedEan ? 'true' : 'false'}">
        <div class="price-result-brand">${escapeHtml(item.brand || 'Sin marca')} · ${escapeHtml(item.presentation || 'Presentación sin informar')}</div>
        <div class="price-result-name">${escapeHtml(item.name)}</div>
        <div class="price-result-meta">${itemPriceSummary(item)}</div>
      </button>
    `).join('');
  }

  async function apiRequest(params) {
    if (location.protocol === 'file:' && !window.KIOSCO_CATALOG_API) {
      throw new Error('La consulta de precios necesita abrirse desde la versión publicada de la app.');
    }
    const url = new URL(API_URL, location.href);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('lat', state.location.lat);
    url.searchParams.set('lng', state.location.lng);
    const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('La consulta no devolvió datos válidos.');
    }
    if (!response.ok) throw new Error(data?.error || 'No se pudieron consultar los precios.');
    return data;
  }

  async function searchProducts() {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchInput.focus();
      notify('Escribí al menos 2 caracteres');
      return;
    }
    const requestId = ++state.searchRequest;
    searchButton.disabled = true;
    state.items = [];
    state.selectedEan = null;
    state.detail = null;
    resultCount.textContent = '…';
    resultsElement.innerHTML = loadingHtml('Buscando variantes exactas…');
      detailElement.innerHTML = '<div class="price-detail-empty">Sin variante seleccionada.</div>';

    try {
      const data = await apiRequest({ action: 'search', q: query });
      if (requestId !== state.searchRequest) return;
      state.items = Array.isArray(data.items) ? data.items : [];
      renderResults();
      if (state.items.length === 1 && /^\d{8,18}$/.test(query.replace(/\D/g, ''))) {
        loadDetail(state.items[0].ean);
      }
    } catch (error) {
      if (requestId !== state.searchRequest) return;
      resultCount.textContent = '0';
      resultsElement.innerHTML = errorHtml(error.message);
    } finally {
      if (requestId === state.searchRequest) searchButton.disabled = false;
    }
  }

  function referenceRange(reference) {
    if (!reference?.count) return 'Sin comercios con precio vigente';
    if (reference.min === reference.max) return `${reference.count} comercio${reference.count === 1 ? '' : 's'} · ${reference.updatedToday ? 'actualizado hoy' : 'último precio informado'}`;
    return `${reference.count} comercios · rango ${money(reference.min)} a ${money(reference.max)}${reference.updatedToday ? ' · actualizado hoy' : ''}`;
  }

  function wholesaleRange(reference) {
    if (!reference?.count) return 'Sin valor mayorista con IVA en esta zona';
    const range = reference.unitWithVatMin === reference.unitWithVatMax
      ? ''
      : ` · rango ${money(reference.unitWithVatMin)} a ${money(reference.unitWithVatMax)}`;
    return `${reference.count} mayorista${reference.count === 1 ? '' : 's'}${range}${reference.updatedToday ? ' · actualizado hoy' : ''}`;
  }

  function shopRows(stores, wholesale) {
    return stores.map(store => {
      const distance = Number.isFinite(store.distanceKm) ? ` · ${store.distanceKm.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km` : '';
      const value = wholesale ? store.unitWithVat : store.price;
      const pack = wholesale && store.unitsPerPack > 1
        ? ` · bulto x${Math.round(store.unitsPerPack)} ${money(store.packWithVat)}`
        : '';
      return `<div class="price-shop-row"><div><span>${escapeHtml(store.store)}</span><small>${escapeHtml(store.address || store.locality)}${escapeHtml(distance)}${escapeHtml(pack)}</small></div><strong>${money(value)}</strong></div>`;
    }).join('');
  }

  function shopDetails(title, stores, wholesale) {
    if (!stores.length) return '';
    return `<details class="price-shop-details"><summary><span>${escapeHtml(title)} (${stores.length})</span></summary><div class="price-shop-list">${shopRows(stores, wholesale)}</div></details>`;
  }

  function renderDetail(data) {
    state.detail = data;
    const product = data.product || {};
    const retail = data.retailReference || {};
    const wholesale = data.wholesaleReference || {};
    const saved = readSavedPrices()[product.ean] || {};
    const suggestedUnits = wholesale.unitsPerPackMedian > 1 ? Math.round(wholesale.unitsPerPackMedian) : null;
    const unitsValue = saved.units || suggestedUnits || '';
    const image = /^https:\/\//.test(data.image || '')
      ? `<img id="priceProductImage" src="${escapeHtml(data.image)}" alt="${escapeHtml(product.name)}">`
      : '<div class="price-product-placeholder">$</div>';
    const costHint = wholesale.unitWithVatMedian
      ? `Vacío: usa ${money(wholesale.unitWithVatMedian)} mayorista c/IVA.`
      : 'Sin referencia mayorista: cargá tu costo real.';
    const packHint = suggestedUnits
      ? `SEPA informa ${suggestedUnits} unidades.`
      : 'Opcional para calcular el bulto.';

    detailElement.innerHTML = `
      <div class="price-product-head">
        <div class="price-product-image" id="priceProductImageBox">${image}</div>
        <div>
          <div class="price-product-brand">${escapeHtml(product.brand || 'Sin marca')}</div>
          <div class="price-product-name">${escapeHtml(product.name || 'Producto')}</div>
          <div class="price-product-meta"><span>${escapeHtml(product.presentation || 'Presentación sin informar')}</span><span>EAN ${escapeHtml(product.ean)}</span></div>
        </div>
      </div>

      <div class="price-reference-grid">
        <section class="price-reference">
          <div class="price-reference-label">Referencia minorista</div>
          <div class="price-reference-value">${money(retail.median)}</div>
          <div class="price-reference-note">${escapeHtml(referenceRange(retail))}</div>
        </section>
        <section class="price-reference">
          <div class="price-reference-label">Referencia mayorista por unidad · c/IVA</div>
          <div class="price-reference-value wholesale">${money(wholesale.unitWithVatMedian)}</div>
          <div class="price-reference-note">${escapeHtml(wholesaleRange(wholesale))}</div>
        </section>
      </div>

      ${shopDetails('Precios minoristas considerados', data.retailStores || [], false)}
      ${shopDetails('Precios mayoristas considerados', data.wholesaleStores || [], true)}

      <section class="price-own-section">
        <div class="price-own-head">
          <div><div class="price-own-title">Tu precio y tu margen</div><div class="price-own-sub">Precio de venta, costo y bulto</div></div>
          <span class="price-saved" id="priceSavedStatus">Guardado para este EAN</span>
        </div>
        <form class="price-calc-form" id="priceCalcForm" data-ean="${escapeHtml(product.ean)}">
          <div class="price-field">
            <label for="priceOwnSale">Mi precio de venta</label>
            <input class="price-input" id="priceOwnSale" data-testid="price-own-sale" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${escapeHtml(numberInputValue(saved.sale))}" required>
            <div class="price-field-hint">Se guarda para esta presentación.</div>
          </div>
          <div class="price-field">
            <label for="priceOwnCost">Mi costo real (opcional)</label>
            <input class="price-input" id="priceOwnCost" data-testid="price-own-cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="${escapeHtml(numberInputValue(saved.cost))}">
            <div class="price-field-hint">${escapeHtml(costHint)}</div>
          </div>
          <div class="price-field">
            <label for="pricePackUnits">Unidades por bulto</label>
            <input class="price-input" id="pricePackUnits" data-testid="price-pack-units" type="number" min="1" step="1" inputmode="numeric" placeholder="Ej. 40" value="${escapeHtml(numberInputValue(unitsValue))}">
            <div class="price-field-hint">${escapeHtml(packHint)}</div>
          </div>
          <button class="price-calc-btn" data-testid="price-calculate" type="submit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
            Calcular
          </button>
        </form>
        <div class="price-metrics" id="priceMetrics" data-testid="price-metrics" hidden>
          <div class="price-cost-used"><span>Base del cálculo</span><strong id="priceCostUsed">—</strong></div>
          <div class="price-metric-grid" id="priceMetricGrid"></div>
          <div class="price-pack-band" id="pricePackBand" hidden></div>
        </div>
      </section>
    `;

    const productImage = document.getElementById('priceProductImage');
    if (productImage) {
      productImage.addEventListener('error', () => {
        document.getElementById('priceProductImageBox').innerHTML = '<div class="price-product-placeholder">$</div>';
      }, { once: true });
    }
    if (saved.sale) calculateMetrics(false);
    if (panel && window.matchMedia('(max-width: 720px)').matches) {
      setTimeout(() => {
        const targetTop = detailElement.getBoundingClientRect().top
          - panel.getBoundingClientRect().top
          + panel.scrollTop;
        const headerHeight = priceHeader?.getBoundingClientRect().height || 0;
        panel.scrollTo({ top: Math.max(0, targetTop - headerHeight - 8), behavior: 'smooth' });
      }, 60);
    }
  }

  function metricCard(label, value, note, className = '') {
    return `<div class="price-metric"><div class="price-metric-label">${escapeHtml(label)}</div><div class="price-metric-value ${className}">${escapeHtml(value)}</div><div class="price-metric-note">${escapeHtml(note)}</div></div>`;
  }

  function performanceClass(value, goodAt, warnAt) {
    if (!Number.isFinite(value)) return '';
    if (value >= goodAt) return 'good';
    if (value >= warnAt) return 'warn';
    return 'bad';
  }

  function calculateMetrics(shouldNotify) {
    const form = document.getElementById('priceCalcForm');
    if (!form || !state.detail) return;
    const saleInput = document.getElementById('priceOwnSale');
    const costInput = document.getElementById('priceOwnCost');
    const unitsInput = document.getElementById('pricePackUnits');
    const sale = Number(saleInput.value);
    const realCost = Number(costInput.value);
    const units = Number(unitsInput.value);
    const estimatedCost = Number(state.detail.wholesaleReference?.unitWithVatMedian);
    if (!Number.isFinite(sale) || sale <= 0) {
      saleInput.focus();
      notify('Ingresá tu precio de venta');
      return;
    }

    const hasRealCost = Number.isFinite(realCost) && realCost > 0;
    const hasEstimatedCost = Number.isFinite(estimatedCost) && estimatedCost > 0;
    const cost = hasRealCost ? realCost : (hasEstimatedCost ? estimatedCost : null);
    const retail = Number(state.detail.retailReference?.median);
    const marketDelta = Number.isFinite(retail) && retail > 0 ? ((sale - retail) / retail) * 100 : null;
    const profit = cost ? sale - cost : null;
    const margin = cost ? (profit / sale) * 100 : null;
    const markup = cost ? (profit / cost) * 100 : null;
    const costLabel = hasRealCost ? `Tu costo real: ${money(cost)}` : (hasEstimatedCost ? `Referencia mayorista c/IVA: ${money(cost)}` : 'Sin costo cargado');

    document.getElementById('priceCostUsed').textContent = costLabel;
    const marketNote = Number.isFinite(marketDelta)
      ? `Tu precio ${money(sale)} · mercado ${money(retail)}`
      : 'Sin referencia minorista para comparar';
    const costMissingNote = 'Ingresá tu costo real para calcularlo';
    document.getElementById('priceMetricGrid').innerHTML = [
      metricCard('Vs. minorista', percentage(marketDelta), marketNote),
      metricCard('Ganancia por unidad', profit === null ? '—' : money(profit), profit === null ? costMissingNote : `Venta ${money(sale)} − costo ${money(cost)}`, profit === null ? '' : (profit >= 0 ? 'good' : 'bad')),
      metricCard('Margen sobre venta', margin === null ? '—' : percentage(margin), margin === null ? costMissingNote : '(venta − costo) / venta', performanceClass(margin, 25, 12)),
      metricCard('Recargo sobre costo', markup === null ? '—' : percentage(markup), markup === null ? costMissingNote : '(venta − costo) / costo', performanceClass(markup, 35, 15)),
    ].join('');

    const packBand = document.getElementById('pricePackBand');
    if (cost && Number.isFinite(units) && units > 1) {
      packBand.innerHTML = [
        metricCard(`Inversión bulto · x${Math.round(units)}`, money(cost * units), 'Costo por unidad × cantidad'),
        metricCard(`Venta bulto · x${Math.round(units)}`, money(sale * units), 'Precio de venta × cantidad'),
        metricCard('Ganancia del bulto', money(profit * units), 'Antes de otros gastos', profit >= 0 ? 'good' : 'bad'),
      ].join('');
      packBand.hidden = false;
    } else {
      packBand.hidden = true;
      packBand.innerHTML = '';
    }

    document.getElementById('priceMetrics').hidden = false;
    saveOwnPrice(form.dataset.ean, {
      sale,
      cost: hasRealCost ? realCost : null,
      units: Number.isFinite(units) && units > 0 ? Math.round(units) : null,
    });
    document.getElementById('priceSavedStatus').classList.add('show');
    if (shouldNotify) notify('Precio y cálculo guardados');
  }

  async function loadDetail(ean) {
    const requestId = ++state.detailRequest;
    state.selectedEan = ean;
    renderResults();
    detailElement.innerHTML = loadingHtml('Consultando precios por comercio…');
    try {
      const data = await apiRequest({ action: 'detail', ean });
      if (requestId !== state.detailRequest) return;
      renderDetail(data);
    } catch (error) {
      if (requestId !== state.detailRequest) return;
      detailElement.innerHTML = errorHtml(error.message);
    }
  }

  async function refreshForLocation() {
    state.selectedEan = null;
    state.detail = null;
    if (searchInput.value.trim().length >= 2) await searchProducts();
  }

  openButton.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) setOpen(false);
  });
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    searchProducts();
  });
  resultsElement.addEventListener('click', event => {
    const button = event.target.closest('.price-result');
    if (button?.dataset.ean) loadDetail(button.dataset.ean);
  });
  detailElement.addEventListener('submit', event => {
    if (event.target.id !== 'priceCalcForm') return;
    event.preventDefault();
    calculateMetrics(true);
  });
  locationPreset.addEventListener('change', () => {
    const selected = LOCATIONS[locationPreset.value];
    if (!selected) return;
    saveLocation({ ...selected, key: locationPreset.value });
    refreshForLocation();
  });
  useLocationButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
      notify('Este navegador no permite obtener la ubicación');
      return;
    }
    useLocationButton.disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
      saveLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        label: 'Mi ubicación actual',
        key: 'current',
      });
      syncLocationControl();
      useLocationButton.disabled = false;
      notify('Zona de precios actualizada');
      refreshForLocation();
    }, () => {
      useLocationButton.disabled = false;
      notify('No se pudo obtener la ubicación');
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 });
  });

  syncLocationControl();
})();
