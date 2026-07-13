(function initPriceReference() {
  const overlay = document.getElementById('priceOverlay');
  const openButton = document.getElementById('btnPrecios');
  const closeButton = document.getElementById('btnCerrarPrecios');
  const searchForm = document.getElementById('priceSearchForm');
  const searchInput = document.getElementById('priceSearchInput');
  const searchButton = document.getElementById('priceSearchButton');
  const searchWrap = document.getElementById('priceSearchWrap');
  const suggestionsElement = document.getElementById('priceSuggestions');
  const resultsElement = document.getElementById('priceResults');
  const resultCount = document.getElementById('priceResultCount');
  const detailElement = document.getElementById('priceDetail');
  const locationPreset = document.getElementById('priceLocationPreset');
  const useLocationButton = document.getElementById('priceUseLocation');
  const radarList = document.getElementById('priceRadarList');
  const radarScope = document.getElementById('priceRadarScope');
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
    mlItems: [],
    selectedMl: null,
    supplierItems: [],
    selectedSupplier: null,
    suggestions: [],
    suggestionRequest: 0,
    suggestionActive: -1,
    radar: { now: [], ranking: [] },
    radarMeta: { scopeNow: '', scopeRanking: '', dynamic: false, generatedAt: null },
    radarMode: 'ranking',
    radarLoadedAt: 0,
  };
  let suggestionTimer = null;

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

  function catalogText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function inferCategory(name, brand, preferred) {
    if (preferred) return preferred;
    const text = catalogText(`${name || ''} ${brand || ''}`);
    const rules = [
      ['Librería', ['resma', 'birome', 'boligrafo', 'lapicera', 'marcador', 'resaltador', 'cuaderno', 'carpeta', 'lapiz', 'goma', 'regla', 'papel', 'cartulina', 'adhesivo', 'abrochadora', 'clip', 'corrector', 'crayon', 'tempera']],
      ['Chocolates', ['chocolate', 'bombon', 'bon o bon']],
      ['Golosinas', ['alfajor', 'caramelo', 'chicle', 'gomita', 'turron', 'pastilla']],
      ['Bebidas', ['gaseosa', 'agua ', 'jugo', 'cerveza', 'energizante', 'soda']],
      ['Cigarrillos', ['cigarrillo', 'tabaco', 'encendedor']],
      ['Panificados', ['galletita', 'bizcocho', 'pan ', 'budin', 'magdalena']],
      ['Fiambres y lácteos', ['queso', 'fiambre', 'yogur', 'leche', 'manteca']],
      ['Limpieza', ['lavandina', 'detergente', 'limpiador', 'jabon en polvo', 'esponja']],
      ['Perfumería', ['shampoo', 'desodorante', 'dentifrico', 'perfume', 'afeitar']],
      ['Almacén', ['arroz', 'fideo', 'harina', 'azucar', 'yerba', 'cafe', 'aceite']],
      ['Regalería', ['juguete', 'peluche', 'regalo', 'cotillon']],
    ];
    const found = rules.find(([, keywords]) => keywords.some(keyword => text.includes(keyword)));
    return found ? found[0] : 'Kiosco varios';
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
      loadRadar();
      setTimeout(() => searchInput.focus(), 40);
    } else if (typeof window.unlockBody === 'function') {
      hideSuggestions();
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

  function supplierPriceSummary(item) {
    const parts = [];
    if (item.priceType === 'retail') {
      if (item.unitPrice) parts.push(`<span>Minor. online <strong>${money(item.unitPrice)}</strong></span>`);
      if (item.retailMin && item.retailMax && item.retailMin !== item.retailMax) parts.push(`<span>${money(item.retailMin)}–${money(item.retailMax)}</span>`);
      if (item.storeCount) parts.push(`<span>${Number(item.storeCount)} oferta${Number(item.storeCount) === 1 ? '' : 's'}</span>`);
      return parts.length ? parts.join('') : '<span>Consultar precio online</span>';
    }
    if (item.available === false) parts.push('<span style="color:#f87171">Sin stock</span>');
    else if (item.stock !== null && item.stock !== undefined && Number.isFinite(Number(item.stock))) parts.push(`<span>${Number(item.stock)} disponibles</span>`);
    if (item.unitPrice) parts.push(`<span>Mayor. <strong>${money(item.unitPrice)}/u</strong></span>`);
    if (item.packPrice && item.packUnits > 1) parts.push(`<span>Bulto x${Math.round(item.packUnits)} <strong>${money(item.packPrice)}</strong></span>`);
    return parts.length ? parts.join('') : '<span>Consultar disponibilidad</span>';
  }

  function sourceHeading(label, count) {
    return `<div class="price-source-group"><span>${escapeHtml(label)}</span><span>${count}</span></div>`;
  }

  function renderResults() {
    const paneTitle = document.querySelector('.price-pane-title');
    const supplierGroups = [
      ['Open 25 · cadena de kioscos', state.supplierItems.filter(item => item.source === 'open25')],
      ['Rappi · minorista online', state.supplierItems.filter(item => item.source === 'rappi')],
      ['Dulce Sur · kiosco', state.supplierItems.filter(item => item.source === 'dulce-sur')],
      ['Casa Paso · librería', state.supplierItems.filter(item => item.source === 'casa-paso')],
    ].filter(([, items]) => items.length);
    const total = state.items.length + state.supplierItems.length;
    if (paneTitle) paneTitle.textContent = supplierGroups.length ? 'Resultados combinados' : 'Variantes exactas';
    resultCount.textContent = String(total);
    if (!total) {
      resultsElement.innerHTML = '<div class="price-empty"><div class="price-empty-icon">0</div><span>No encontramos una variante vigente en esta zona.</span></div>';
      return;
    }
    const officialHtml = state.items.length ? sourceHeading('Precios Claros', state.items.length) + state.items.map(item => `
      <button class="price-result${item.ean === state.selectedEan ? ' active' : ''}" type="button" data-ean="${escapeHtml(item.ean)}" aria-pressed="${item.ean === state.selectedEan ? 'true' : 'false'}">
        <div class="price-result-brand">${escapeHtml(item.brand || 'Sin marca')} · ${escapeHtml(item.presentation || 'Presentación sin informar')}</div>
        <div class="price-result-name">${escapeHtml(item.name)}</div>
        <div class="price-result-meta">${itemPriceSummary(item)}</div>
      </button>
    `).join('') : '';
    const suppliersHtml = supplierGroups.map(([label, items]) => sourceHeading(label, items.length) + items.map(item => `
      <button class="price-result${item.id === state.selectedSupplier ? ' active' : ''}" type="button" data-supplier-id="${escapeHtml(item.id)}" aria-pressed="${item.id === state.selectedSupplier ? 'true' : 'false'}">
        <div class="price-result-brand">${escapeHtml(item.brand || item.sourceLabel)}${item.presentation ? ` · ${escapeHtml(item.presentation)}` : ''}</div>
        <div class="price-result-name">${escapeHtml(item.title)}</div>
        <div class="price-result-meta">${supplierPriceSummary(item)}</div>
      </button>`).join('')).join('');
    resultsElement.innerHTML = officialHtml + suppliersHtml;
  }

  async function apiRequest(params) {
    if (location.protocol === 'file:' && !window.KIOSCO_CATALOG_API) {
      throw new Error('La consulta de precios necesita abrirse desde la versión publicada de la app.');
    }
    const url = new URL(API_URL, location.href);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('lat', state.location.lat);
    url.searchParams.set('lng', state.location.lng);
    url.searchParams.set('zone', state.location.key || 'current');
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

  function radarDate(value) {
    const date = new Date(`${String(value || '').slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '');
  }

  function renderRadar() {
    if (!radarList) return;
    const items = Array.isArray(state.radar[state.radarMode]) ? state.radar[state.radarMode] : [];
    if (radarScope) {
      radarScope.textContent = state.radarMeta.scopeRanking || 'Argentina · más vendidos';
    }
    if (!items.length) {
      radarList.innerHTML = '<div class="price-radar-error">El radar no devolvió señales vigentes.</div>';
      return;
    }
    radarList.innerHTML = items.map((item, index) => {
      const image = /^https:\/\//.test(item.image || '')
        ? `<img src="${escapeHtml(item.image)}" alt="">`
        : `<span>${state.radarMode === 'ranking' ? escapeHtml(item.rank || index + 1) : '↑'}</span>`;
      const metadata = [
        item.sourceLabel,
        Number(item.confidence) > 0 ? `confianza ${Math.round(Number(item.confidence))}%` : '',
        radarDate(item.date),
      ].filter(Boolean).join(' · ');
      const publicationUrl = /^https:\/\//.test(item.publicationUrl || item.sourceUrl || '')
        ? (item.publicationUrl || item.sourceUrl)
        : '';
      const publicationLabel = item.publicationLabel || 'Abrir publicación';
      const itemTitle = publicationUrl
        ? `${publicationLabel}: ${item.name}${item.note ? `. ${item.note}` : ''}`
        : `Buscar ${item.name}`;
      const openTag = publicationUrl
        ? `<a class="price-radar-item" href="${escapeHtml(publicationUrl)}" data-radar-query="${escapeHtml(item.query || item.name)}" data-radar-url="${escapeHtml(publicationUrl)}" title="${escapeHtml(itemTitle)}">`
        : `<button class="price-radar-item" type="button" data-radar-query="${escapeHtml(item.query || item.name)}" title="${escapeHtml(itemTitle)}">`;
      const closeTag = publicationUrl ? '</a>' : '</button>';
      return `${openTag}
        <span class="price-radar-thumb">${image}</span>
        <span><span class="price-radar-name">${escapeHtml(item.name)}</span><span class="price-radar-signal">${escapeHtml(item.signal)}</span><span class="price-radar-meta">${escapeHtml(metadata)}</span></span>
        <span class="price-radar-go" aria-hidden="true">↗</span>
      ${closeTag}`;
    }).join('');
  }

  async function loadRadar(force = false) {
    if (!radarList) return;
    if (!force && state.radarLoadedAt && Date.now() - state.radarLoadedAt < 30 * 60 * 1000) { renderRadar(); return; }
    radarList.innerHTML = '<div class="price-radar-loading">Actualizando radar…</div>';
    try {
      const data = await apiRequest({ action: 'radar' });
      state.radar = {
        now: Array.isArray(data.now) ? data.now : [],
        ranking: Array.isArray(data.ranking) ? data.ranking : [],
      };
      state.radarMeta = {
        scopeNow: data.scopeNow || data.scope || '',
        scopeRanking: data.scopeRanking || '',
        dynamic: data.dynamic === true,
        generatedAt: data.generatedAt || data.checkedAt || null,
      };
      state.radarLoadedAt = Date.now();
      renderRadar();
    } catch {
      radarList.innerHTML = '<div class="price-radar-error">Radar temporalmente no disponible.</div>';
    }
  }

  function hideSuggestions() {
    if (!suggestionsElement) return;
    suggestionsElement.hidden = true;
    suggestionsElement.innerHTML = '';
    state.suggestions = [];
    state.suggestionActive = -1;
    searchInput.setAttribute('aria-expanded', 'false');
  }

  function renderSuggestions() {
    if (!suggestionsElement || !state.suggestions.length) { hideSuggestions(); return; }
    suggestionsElement.innerHTML = state.suggestions.map((item, index) => `
      <button class="price-suggestion${index === state.suggestionActive ? ' active' : ''}" type="button" role="option" aria-selected="${index === state.suggestionActive ? 'true' : 'false'}" data-suggestion-index="${index}">
        <span><span class="price-suggestion-name">${escapeHtml(item.title)}</span><span class="price-suggestion-meta">${escapeHtml(item.sourceLabel || 'Producto')}${item.presentation ? ` · ${escapeHtml(item.presentation)}` : ''}</span></span>
        <span class="price-suggestion-price">${item.unitPrice ? money(item.unitPrice) : ''}</span>
      </button>`).join('');
    suggestionsElement.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function localCatalogSuggestions(query) {
    const normalized = catalogText(query).trim();
    if (!normalized) return [];
    return catItems().filter(record => catalogText([record.nombre, record.marca, record.presentacion].filter(Boolean).join(' ')).includes(normalized)).slice(0, 4).map(record => ({
      id: `catalog:${record.uid}`,
      source: 'catalog',
      sourceLabel: 'Mi catálogo',
      title: record.nombre,
      presentation: record.marca || record.presentacion || '',
      unitPrice: Number(record.precio) || null,
    }));
  }

  async function loadSuggestions() {
    const query = searchInput.value.trim();
    if (query.length < 2) { state.suggestionRequest += 1; hideSuggestions(); return; }
    const requestId = ++state.suggestionRequest;
    const local = localCatalogSuggestions(query);
    try {
      const data = await apiRequest({ action: 'suggest', q: query });
      if (requestId !== state.suggestionRequest || searchInput.value.trim() !== query) return;
      const remote = Array.isArray(data.items) ? data.items : [];
      const merged = [];
      const seen = new Set();
      [...local, ...remote].forEach(item => {
        const key = catalogText(item.title);
        if (!key || seen.has(key) || merged.length >= 8) return;
        seen.add(key);
        merged.push(item);
      });
      state.suggestions = merged;
      state.suggestionActive = -1;
      renderSuggestions();
    } catch {
      if (requestId !== state.suggestionRequest) return;
      state.suggestions = local;
      state.suggestionActive = -1;
      renderSuggestions();
    }
  }

  function scheduleSuggestions() {
    clearTimeout(suggestionTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) { state.suggestionRequest += 1; hideSuggestions(); return; }
    suggestionTimer = setTimeout(loadSuggestions, 360);
  }

  function chooseSuggestion(index) {
    const item = state.suggestions[index];
    if (!item) return;
    const availableSuggestions = state.suggestions.slice();
    searchInput.value = item.title;
    hideSuggestions();
    if (item.source === 'casa-paso' || item.source === 'dulce-sur' || item.source === 'rappi' || item.source === 'open25') {
      state.items = [];
      state.selectedEan = null;
      state.detail = null;
      state.mlItems = [];
      state.selectedMl = null;
      state.supplierItems = availableSuggestions.filter(entry => ['casa-paso', 'dulce-sur', 'rappi', 'open25'].includes(entry.source));
      if (!state.supplierItems.some(entry => entry.id === item.id)) state.supplierItems.unshift(item);
      state.selectedSupplier = item.id;
      renderResults();
      showSupplierDetail(item.id);
      return;
    }
    searchProducts();
  }

  async function searchProducts(options = {}) {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchInput.focus();
      notify('Escribí al menos 2 caracteres');
      return;
    }
    hideSuggestions();
    const requestId = ++state.searchRequest;
    searchButton.disabled = true;
    state.items = [];
    state.selectedEan = null;
    state.detail = null;
    state.mlItems = [];
    state.selectedMl = null;
    state.supplierItems = [];
    state.selectedSupplier = null;
    resultCount.textContent = '…';
    resultsElement.innerHTML = loadingHtml('Buscando variantes exactas…');
    detailElement.innerHTML = '<div class="price-detail-empty">Sin variante seleccionada.</div>';

    try {
      const data = await apiRequest({ action: 'search', q: query });
      if (requestId !== state.searchRequest) return;
      state.items = Array.isArray(data.items) ? data.items : [];
      state.supplierItems = Array.isArray(data.supplierItems) ? data.supplierItems : [];
      if (!state.items.length && !state.supplierItems.length) {
        resultsElement.innerHTML = loadingHtml('Buscando una alternativa en Mercado Libre…');
        const rescued = await searchMercadoLibre(query, requestId);
        if (!rescued && requestId === state.searchRequest) renderResults();
      } else {
        renderResults();
        if (options.autoOpen && state.supplierItems.length) {
          const preferred = state.supplierItems.find(item => item.source === 'open25')
            || state.supplierItems.find(item => item.source === 'rappi')
            || state.supplierItems[0];
          showSupplierDetail(preferred.id);
        } else if (state.items.length === 1 && !state.supplierItems.length && /^\d{8,18}$/.test(query.replace(/\D/g, ''))) {
          loadDetail(state.items[0].ean);
        }
      }
    } catch (error) {
      if (requestId !== state.searchRequest) return;
      const rescued = await searchMercadoLibre(query, requestId);
      if (!rescued && requestId === state.searchRequest) {
        resultCount.textContent = '0';
        resultsElement.innerHTML = errorHtml(error.message);
      }
    } finally {
      if (requestId === state.searchRequest) searchButton.disabled = false;
    }
  }

  // Busca publicaciones activas en MercadoLibre cuando la fuente oficial
  // no tiene el producto. Devuelve true si llegó a mostrar resultados.
  async function searchMercadoLibre(query, requestId) {
    try {
      const data = await apiRequest({ action: 'ml', q: query });
      if (requestId !== state.searchRequest) return true;
      if (data.disabled || !Array.isArray(data.items) || !data.items.length) return false;
      state.mlItems = data.items;
      renderMlResults();
      return true;
    } catch (error) {
      return false;
    }
  }

  function renderMlResults() {
    const paneTitle = document.querySelector('.price-pane-title');
    if (paneTitle) paneTitle.textContent = 'Resultados MercadoLibre';
    resultCount.textContent = String(state.mlItems.length);
    resultsElement.innerHTML = '<div class="price-ml-note">Catálogo Mercado Libre. El precio aparece sólo cuando existe una publicación ganadora vigente.</div>'
      + state.mlItems.map(item => `
      <button class="price-result${item.id === state.selectedMl ? ' active' : ''}" type="button" data-ml-id="${escapeHtml(item.id)}" aria-pressed="${item.id === state.selectedMl ? 'true' : 'false'}">
        <div class="price-result-brand">${escapeHtml(item.brand || 'MercadoLibre')}${item.presentation ? ` · ${escapeHtml(item.presentation)}` : ''}</div>
        <div class="price-result-name">${escapeHtml(item.title)}</div>
        <div class="price-result-meta">${item.price ? `<span>Precio ganador <strong>${money(item.price)}</strong></span>` : '<span>Sin precio automático · consultar en ML</span>'}</div>
      </button>`).join('');
  }

  function showMlDetail(id) {
    const item = state.mlItems.find(entry => entry.id === id);
    if (!item) return;
    state.selectedMl = id;
    renderMlResults();
    renderDetail({
      mlSource: true,
      permalink: item.permalink,
      suggestedCategory: item.suggestedCategory || inferCategory(item.title, item.brand),
      product: {
        ean: item.ean || `ML:${item.id}`,
        name: item.title,
        brand: item.brand || '',
        presentation: item.presentation || 'Producto de catálogo',
      },
      image: item.image,
      retailReference: item.reference || {},
      wholesaleReference: {},
      retailStores: [],
      wholesaleStores: [],
    });
  }

  function supplierMatchTokens(item) {
    const ignored = new Set(['alfajor', 'chocolate', 'unidad', 'caja', 'pack']);
    const singular = {
      alfajores: 'alfajor', chocolates: 'chocolate', unidades: 'unidad', cajas: 'caja',
      resmas: 'resma', hojas: 'hoja', marcadores: 'marcador', biromes: 'birome',
      boligrafos: 'boligrafo', caramelos: 'caramelo', galletitas: 'galletita',
    };
    return catalogText(`${item.brand || ''} ${item.title || ''}`).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .map(token => singular[token] || (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token))
      .filter(token => token.length > 2 && !ignored.has(token) && !/^\d/.test(token));
  }

  function comparisonItemTokens(item) {
    return supplierMatchTokens({
      brand: item.brand || '',
      title: `${item.title || item.name || ''} ${item.presentation || ''}`,
    });
  }

  function comparisonSource(item) {
    return item.source || 'precios-claros';
  }

  function comparisonId(item) {
    return item.id || `pc:${item.ean || item.code || item.name}`;
  }

  function sourceOffer(item, selected, score) {
    const source = comparisonSource(item);
    const isOfficial = source === 'precios-claros';
    const retailPrice = isOfficial ? Number(item.retail?.min) || null : (item.priceType === 'retail' ? Number(item.unitPrice) || null : null);
    const wholesalePrice = isOfficial ? Number(item.wholesale?.unitWithVatMin) || null : (item.priceType === 'retail' ? null : Number(item.unitPrice) || null);
    return {
      id: comparisonId(item),
      source,
      sourceLabel: isOfficial ? 'Precios Claros' : item.sourceLabel,
      title: item.title || item.name || 'Producto',
      presentation: item.presentation || '',
      retailPrice,
      retailMin: isOfficial ? Number(item.retail?.min) || null : Number(item.retailMin) || retailPrice,
      retailMax: isOfficial ? Number(item.retail?.max) || null : Number(item.retailMax) || retailPrice,
      wholesalePrice,
      packPrice: Number(item.packPrice) || (isOfficial ? Number(item.wholesale?.packWithVatMin) || null : null),
      packUnits: Number(item.packUnits) || null,
      permalink: item.permalink || '',
      selected,
      matchType: selected ? 'selected' : (score >= 0.55 ? 'same' : 'similar'),
      score,
    };
  }

  function sourceOffersFor(selectedItem) {
    if (!selectedItem) return [];
    const selectedTokens = new Set(comparisonItemTokens(selectedItem));
    const selectedSource = comparisonSource(selectedItem);
    const selectedId = comparisonId(selectedItem);
    const candidates = [
      ...state.items.map(item => ({ ...item, source: 'precios-claros' })),
      ...state.supplierItems,
    ];
    if (!candidates.some(item => comparisonId(item) === selectedId)) candidates.unshift(selectedItem);

    const ranked = candidates.map(item => {
      const tokens = new Set(comparisonItemTokens(item));
      const shared = [...selectedTokens].filter(token => tokens.has(token)).length;
      const score = shared / Math.max(selectedTokens.size, tokens.size, 1);
      const selected = comparisonId(item) === selectedId;
      return { item, selected, score, shared };
    }).filter(row => row.selected || row.shared > 0);

    const sourceOrder = ['precios-claros', 'open25', 'rappi', 'dulce-sur', 'casa-paso'];
    const offers = [];
    sourceOrder.forEach(source => {
      const rows = ranked.filter(row => comparisonSource(row.item) === source)
        .sort((a, b) => Number(b.selected) - Number(a.selected) || b.score - a.score || (Number(a.item.unitPrice) || Infinity) - (Number(b.item.unitPrice) || Infinity));
      const visible = source === selectedSource ? rows.filter(row => row.selected).slice(0, 1) : rows.slice(0, 3);
      visible.forEach(row => offers.push(sourceOffer(row.item, row.selected, row.score)));
    });
    return offers;
  }

  function supplierCompanion(item, source) {
    const target = new Set(supplierMatchTokens(item));
    if (!target.size) return null;
    return state.supplierItems.map(candidate => {
      if (candidate.source !== source || candidate.id === item.id) return { candidate, score: 0 };
      const tokens = new Set(supplierMatchTokens(candidate));
      const matches = [...target].filter(token => tokens.has(token)).length;
      const score = matches / Math.max(target.size, tokens.size, 1);
      return { candidate, score };
    }).sort((a, b) => b.score - a.score).find(row => row.score >= 0.55)?.candidate || null;
  }

  function supplierDetailData(item) {
    const retailItem = item.priceType === 'retail'
      ? item
      : (supplierCompanion(item, 'open25') || supplierCompanion(item, 'rappi'));
    const wholesaleItem = item.priceType === 'retail'
      ? (supplierCompanion(item, 'dulce-sur') || supplierCompanion(item, 'casa-paso'))
      : item;
    const units = Number(wholesaleItem?.packUnits) > 1 ? Math.round(Number(wholesaleItem.packUnits)) : null;
    const unitPrice = Number(wholesaleItem?.unitPrice) || null;
    const packPrice = Number(wholesaleItem?.packPrice) || (unitPrice && units ? unitPrice * units : null);
    const retailPrice = Number(retailItem?.unitPrice) || null;
    const updatedToday = retailItem?.updatedAt ? String(retailItem.updatedAt).slice(0, 10) === new Date().toISOString().slice(0, 10) : false;
    const productItem = wholesaleItem || item;
    const links = [retailItem, wholesaleItem].filter(Boolean).filter((entry, index, rows) => rows.findIndex(row => row.source === entry.source) === index)
      .map(entry => ({ label: entry.sourceLabel, url: entry.permalink }));
    return {
      supplierSource: item.source,
      retailSource: retailItem?.source || null,
      supplierPriceType: retailItem && wholesaleItem ? 'combined' : (retailItem ? 'retail' : 'wholesale'),
      sourceLabel: [retailItem?.sourceLabel, wholesaleItem?.sourceLabel].filter(Boolean).join(' + ') || item.sourceLabel,
      permalink: item.permalink,
      sourceLinks: links,
      supplierPackPrice: packPrice,
      supplierPackUnits: units,
      supplierMinimum: Number(wholesaleItem?.minimum) || 1,
      supplierAvailable: wholesaleItem ? wholesaleItem.available !== false : true,
      suggestedCategory: productItem.category || inferCategory(productItem.title, productItem.brand),
      product: {
        ean: productItem.code || productItem.id,
        name: productItem.title,
        brand: productItem.brand || productItem.sourceLabel || '',
        presentation: productItem.presentation || (units ? `Bulto x${units}` : 'Unidad'),
      },
      image: productItem.image || retailItem?.image,
      retailReference: retailItem ? {
        median: retailPrice,
        min: Number(retailItem.retailMin) || retailPrice,
        max: Number(retailItem.retailMax) || retailPrice,
        count: Number(retailItem.storeCount) || 1,
        updatedToday,
      } : {},
      wholesaleReference: wholesaleItem ? {
        unitWithVatMedian: unitPrice,
        unitWithVatMin: unitPrice,
        unitWithVatMax: unitPrice,
        packWithVatMedian: packPrice,
        unitsPerPackMedian: units,
        count: unitPrice ? 1 : 0,
        updatedToday: wholesaleItem.updatedAt ? String(wholesaleItem.updatedAt).slice(0, 10) === new Date().toISOString().slice(0, 10) : false,
      } : {},
      retailStores: [],
      wholesaleStores: wholesaleItem && unitPrice ? [{
        store: wholesaleItem.sourceLabel,
        address: wholesaleItem.source === 'casa-paso' ? 'CABA' : 'Longchamps, Buenos Aires',
        locality: 'Buenos Aires',
        unitWithVat: unitPrice,
        packWithVat: packPrice,
        unitsPerPack: units,
      }] : [],
      sourceOffers: sourceOffersFor(item),
    };
  }

  async function showSupplierDetail(id) {
    let item = state.supplierItems.find(entry => entry.id === id);
    if (!item) return;
    state.selectedSupplier = id;
    renderResults();
    if (item.source === 'casa-paso' && !item.packUnits) {
      detailElement.innerHTML = loadingHtml('Consultando mínimo y bulto en Casa Paso…');
      try {
        const data = await apiRequest({ action: 'supplier-detail', source: item.source, code: item.code });
        if (state.selectedSupplier !== id || !data.item) return;
        item = { ...item, ...data.item };
        state.supplierItems = state.supplierItems.map(entry => entry.id === id ? item : entry);
        renderResults();
      } catch (error) {
        notify('Casa Paso no informó el detalle; usamos el precio visible');
      }
    }
    renderDetail(supplierDetailData(item));
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

  function sourceOfferValues(offer) {
    const values = [];
    if (offer.retailPrice) {
      const range = offer.retailMin && offer.retailMax && offer.retailMin !== offer.retailMax
        ? `<small>${money(offer.retailMin)} a ${money(offer.retailMax)}</small>`
        : '';
      values.push(`<span><small>Minorista</small><strong>${money(offer.retailPrice)}</strong>${range}</span>`);
    }
    if (offer.wholesalePrice) values.push(`<span><small>Mayorista / u.</small><strong>${money(offer.wholesalePrice)}</strong></span>`);
    if (offer.packPrice && offer.packUnits > 1) values.push(`<span><small>Bulto x${Math.round(offer.packUnits)}</small><strong>${money(offer.packPrice)}</strong></span>`);
    return values.length ? values.join('') : '<span><small>Precio</small><strong>Consultar</strong></span>';
  }

  function sourceOffersHtml(offers) {
    if (!Array.isArray(offers) || offers.length < 2) return '';
    const labels = { selected: 'Producto elegido', same: 'Mismo producto', similar: 'Alternativa similar' };
    const groups = new Map();
    offers.forEach(offer => {
      if (!groups.has(offer.source)) groups.set(offer.source, { label: offer.sourceLabel, offers: [] });
      groups.get(offer.source).offers.push(offer);
    });
    const columns = [...groups.values()].map(group => `
      <div class="price-source-column">
        <div class="price-source-column-title">${escapeHtml(group.label)}</div>
        ${group.offers.map(offer => {
          const content = `
            <span class="price-source-match ${offer.matchType}">${escapeHtml(labels[offer.matchType])}</span>
            <span class="price-source-product">${escapeHtml(offer.title)}</span>
            ${offer.presentation ? `<span class="price-source-presentation">${escapeHtml(offer.presentation)}</span>` : ''}
            <span class="price-source-values">${sourceOfferValues(offer)}</span>`;
          return offer.permalink
            ? `<a class="price-source-offer" href="${escapeHtml(offer.permalink)}" target="_blank" rel="noopener">${content}</a>`
            : `<div class="price-source-offer">${content}</div>`;
        }).join('')}
      </div>`).join('');
    return `
      <section class="price-source-comparison">
        <div class="price-source-comparison-head"><div><strong>Precios por fuente</strong><small>Reunidos automáticamente para el producto elegido</small></div></div>
        <div class="price-source-columns">${columns}</div>
        <div class="price-source-warning">Las alternativas similares pueden cambiar de marca, gramaje o presentación. No se usan solas para calcular tu margen.</div>
      </section>`;
  }

  function renderDetail(data) {
    let retail = data.retailReference || {};
    const wholesale = data.wholesaleReference || {};
    let retailLabel = 'Referencia minorista';
    let retailNote = referenceRange(retail);
    let retailDisplayValue = retail.median;
    let wholesaleLabel = 'Referencia mayorista por unidad · c/IVA';
    if (data.supplierSource && (data.supplierPriceType === 'retail' || data.supplierPriceType === 'combined')) {
      retailLabel = data.supplierPriceType === 'combined' ? 'Referencia minorista online' : `Precio publicado en ${data.sourceLabel}`;
      retailDisplayValue = retail.median;
      const range = retail.min && retail.max && retail.min !== retail.max ? ` · rango ${money(retail.min)} a ${money(retail.max)}` : '';
      retailNote = data.retailSource === 'open25'
        ? `Precio de venta al público en la tienda online de Open 25${range}`
        : `${retail.count || 1} oferta${retail.count === 1 ? '' : 's'} en Buenos Aires${range} · puede incluir promoción o recargo de delivery`;
      if (data.supplierPriceType === 'combined') wholesaleLabel = 'Costo mayorista por unidad · c/IVA';
    } else if (data.supplierSource) {
      const packText = data.supplierPackUnits > 1
        ? `Bulto x${data.supplierPackUnits}${data.supplierMinimum > 1 ? ` · mínimo x${data.supplierMinimum}` : ''}`
        : (data.supplierMinimum > 1 ? `Compra mínima x${data.supplierMinimum}` : 'Venta por unidad');
      retailLabel = `Precio publicado en ${data.sourceLabel}`;
      retailDisplayValue = data.supplierPackPrice || wholesale.unitWithVatMedian;
      retailNote = `${packText} · ${data.supplierAvailable ? 'disponible' : 'sin stock'}`;
      wholesaleLabel = 'Costo orientativo por unidad · c/IVA';
    } else if (data.mlSource) {
      retailLabel = 'Precio ganador Mercado Libre';
      retailNote = retail.count
        ? (retail.min === retail.max ? 'Publicación ganadora vigente' : `Rango publicado ${money(retail.min)} a ${money(retail.max)}`)
        : 'Mercado Libre no expone un precio automático para esta variante';
    } else if (!retail.count && data.mlReference?.count) {
      // Precios Claros no tiene minoristas para este EAN: usamos MercadoLibre.
      retail = { median: data.mlReference.median, min: data.mlReference.min, max: data.mlReference.max, count: data.mlReference.count, updatedToday: false };
      retailDisplayValue = retail.median;
      data.retailReference = retail; // así "vs. mercado" compara contra esta referencia
      retailLabel = 'Referencia MercadoLibre';
      retailNote = `Sin minoristas oficiales · ${retail.count} publicaciones ML, rango ${money(retail.min)} a ${money(retail.max)}`;
    }
    state.detail = data;
    const product = data.product || {};
    const saved = readSavedPrices()[product.ean] || {};
    const catRecord = catByEan(product.ean);
    const savedCat = catRecord?.categoria || data.suggestedCategory || inferCategory(product.name, product.brand);
    const suggestedUnits = wholesale.unitsPerPackMedian > 1 ? Math.round(wholesale.unitsPerPackMedian) : null;
    const unitsValue = saved.units || suggestedUnits || '';
    const image = /^https:\/\//.test(data.image || '')
      ? `<img id="priceProductImage" src="${escapeHtml(data.image)}" alt="${escapeHtml(product.name)}">`
      : '<div class="price-product-placeholder">$</div>';
    const costHint = wholesale.unitWithVatMedian
      ? `Vacío: usa ${money(wholesale.unitWithVatMedian)} mayorista c/IVA.`
      : 'Sin referencia mayorista: cargá tu costo real.';
    const packHint = suggestedUnits
      ? `${data.sourceLabel || 'La fuente'} informa ${suggestedUnits} unidades.`
      : 'Opcional para calcular el bulto.';
    const sourceLinks = Array.isArray(data.sourceLinks) && data.sourceLinks.length
      ? data.sourceLinks.map(link => `<a class="price-ml-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)} ↗</a>`).join('')
      : (data.permalink ? `<a class="price-ml-link" href="${escapeHtml(data.permalink)}" target="_blank" rel="noopener">Ver en ${escapeHtml(data.sourceLabel || 'Mercado Libre')} ↗</a>` : '');
    const productMeta = data.permalink
      ? `<span>${data.supplierSource ? 'Código' : 'EAN'} ${escapeHtml(product.ean || 'sin informar')}</span>${sourceLinks}`
      : `<span>EAN ${escapeHtml(product.ean)}</span>`;

    detailElement.innerHTML = `
      <div class="price-product-head">
        <div class="price-product-image" id="priceProductImageBox">${image}</div>
        <div>
          <div class="price-product-brand">${escapeHtml(product.brand || 'Sin marca')}</div>
          <div class="price-product-name">${escapeHtml(product.name || 'Producto')}</div>
          <div class="price-product-meta"><span>${escapeHtml(product.presentation || 'Presentación sin informar')}</span>${productMeta}</div>
        </div>
      </div>

      <div class="price-reference-grid">
        <section class="price-reference">
          <div class="price-reference-label">${escapeHtml(retailLabel)}</div>
          <div class="price-reference-value">${money(retailDisplayValue)}</div>
          <div class="price-reference-note">${escapeHtml(retailNote)}</div>
        </section>
        <section class="price-reference">
          <div class="price-reference-label">${escapeHtml(wholesaleLabel)}</div>
          <div class="price-reference-value wholesale">${money(wholesale.unitWithVatMedian)}</div>
          <div class="price-reference-note">${escapeHtml(wholesaleRange(wholesale))}</div>
        </section>
      </div>

      ${sourceOffersHtml(data.sourceOffers)}

      ${shopDetails('Precios minoristas considerados', data.retailStores || [], false)}
      ${shopDetails('Precios mayoristas considerados', data.wholesaleStores || [], true)}

      <section class="price-own-section">
        <div class="price-own-head">
          <div><div class="price-own-title">Tu precio y tu margen</div><div class="price-own-sub">Precio de venta, costo y bulto</div></div>
          <span class="price-saved" id="priceSavedStatus">Guardado para este ${data.supplierSource ? 'producto' : 'EAN'}</span>
        </div>
        <div class="price-cat-row">
          <div class="price-field">
            <label for="priceOwnCategory">Categoría para tu catálogo</label>
            <input class="price-input" id="priceOwnCategory" list="catCategoriasList" maxlength="40" placeholder="Ej. Golosinas" value="${escapeHtml(savedCat)}">
            <div class="price-field-hint">Al calcular, este producto se guarda en “Mi catálogo”.</div>
          </div>
          <div class="price-field">
            <label for="priceMargenObj">Margen objetivo %</label>
            <div class="cat-suggest-row">
              <input class="price-input" id="priceMargenObj" type="number" min="1" max="94" step="1" inputmode="numeric" placeholder="30">
              <button type="button" class="cat-suggest-btn" id="priceSugerirBtn">Sugerir precio</button>
            </div>
            <div class="price-field-hint">Usa tu costo real o la referencia mayorista.</div>
          </div>
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

  // Precio de venta sugerido para un margen objetivo, redondeado a $50
  // (margen = (venta − costo) / venta, por eso se divide por 1 − m).
  function suggestPrice(cost, marginPct) {
    const raw = cost / (1 - marginPct / 100);
    return Math.max(50, Math.ceil(raw / 50) * 50);
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

    // Alimenta el catálogo del kiosco con este producto (precio, costo, margen).
    const product = state.detail.product || {};
    const categoria = (document.getElementById('priceOwnCategory')?.value || '').trim()
      || inferCategory(product.name, product.brand, state.detail.suggestedCategory);
    const existing = catByEan(product.ean);
    catUpsert({
      uid: existing ? existing.uid : undefined,
      ean: product.ean ? String(product.ean) : null,
      nombre: product.name || 'Producto',
      marca: product.brand || '',
      presentacion: product.presentation || '',
      categoria,
      costo: hasRealCost ? realCost : (Number(existing?.costo) || 0),
      precio: sale,
      unidades: Number.isFinite(units) && units > 0 ? Math.round(units) : null,
      imagen: state.detail.image || (existing ? existing.imagen : null) || null,
      origen: existing ? existing.origen : (state.detail.supplierSource || (state.detail.mlSource ? 'mercadolibre' : 'preciosclaros')),
    }, { rerender: false });

    document.getElementById('priceSavedStatus').classList.add('show');
    if (shouldNotify) notify(hasRealCost || Number(existing?.costo) > 0 ? 'Guardado en tu catálogo ✓' : 'Guardado · falta cargar el costo real');
  }

  async function loadDetail(ean) {
    const requestId = ++state.detailRequest;
    state.selectedEan = ean;
    renderResults();
    detailElement.innerHTML = loadingHtml('Consultando precios por comercio…');
    try {
      const data = await apiRequest({ action: 'detail', ean });
      if (requestId !== state.detailRequest) return;
      const selected = state.items.find(item => item.ean === ean);
      renderDetail({ ...data, sourceOffers: sourceOffersFor(selected ? { ...selected, source: 'precios-claros' } : { ...data.product, source: 'precios-claros' }) });
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
  let overlayPressStartedInside = false;
  overlay.addEventListener('pointerdown', event => {
    overlayPressStartedInside = Boolean(panel?.contains(event.target));
  }, true);
  overlay.addEventListener('click', event => {
    const startedInside = overlayPressStartedInside;
    overlayPressStartedInside = false;
    if (event.target === overlay && !startedInside) setOpen(false);
  });
  overlay.addEventListener('pointercancel', () => { overlayPressStartedInside = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) setOpen(false);
  });
  searchInput.addEventListener('input', scheduleSuggestions);
  searchInput.addEventListener('focus', () => {
    if (state.suggestions.length) renderSuggestions();
    else scheduleSuggestions();
  });
  searchInput.addEventListener('keydown', event => {
    if (!state.suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.suggestionActive = (state.suggestionActive + 1) % state.suggestions.length;
      renderSuggestions();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.suggestionActive = state.suggestionActive <= 0 ? state.suggestions.length - 1 : state.suggestionActive - 1;
      renderSuggestions();
    } else if (event.key === 'Enter' && state.suggestionActive >= 0) {
      event.preventDefault();
      chooseSuggestion(state.suggestionActive);
    } else if (event.key === 'Escape' && !suggestionsElement.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hideSuggestions();
    }
  });
  suggestionsElement?.addEventListener('click', event => {
    const button = event.target.closest('[data-suggestion-index]');
    if (!button) return;
    chooseSuggestion(Number(button.dataset.suggestionIndex));
  });
  document.addEventListener('pointerdown', event => {
    if (searchWrap && !searchWrap.contains(event.target)) hideSuggestions();
  });
  radarList?.addEventListener('click', event => {
    const button = event.target.closest('[data-radar-query]');
    if (!button) return;
    if (button.dataset.radarUrl) return;
    searchInput.value = button.dataset.radarQuery;
    hideSuggestions();
    searchProducts();
  });
  searchForm.addEventListener('submit', event => {
    event.preventDefault();
    searchProducts();
  });
  resultsElement.addEventListener('click', event => {
    const button = event.target.closest('.price-result');
    if (!button) return;
    if (button.dataset.supplierId) { showSupplierDetail(button.dataset.supplierId); return; }
    if (button.dataset.mlId) { showMlDetail(button.dataset.mlId); return; }
    if (button.dataset.ean) loadDetail(button.dataset.ean);
  });
  detailElement.addEventListener('submit', event => {
    if (event.target.id !== 'priceCalcForm') return;
    event.preventDefault();
    calculateMetrics(true);
  });
  detailElement.addEventListener('click', event => {
    if (event.target.id !== 'priceSugerirBtn') return;
    const marginTarget = Number(document.getElementById('priceMargenObj')?.value) || 30;
    if (marginTarget <= 0 || marginTarget >= 95) { notify('El margen tiene que estar entre 1 y 94%'); return; }
    const ownCost = Number(document.getElementById('priceOwnCost')?.value);
    const estimated = Number(state.detail?.wholesaleReference?.unitWithVatMedian);
    const cost = ownCost > 0 ? ownCost : (estimated > 0 ? estimated : null);
    if (!cost) { notify('Cargá tu costo real para sugerir el precio'); document.getElementById('priceOwnCost')?.focus(); return; }
    const suggested = suggestPrice(cost, marginTarget);
    document.getElementById('priceOwnSale').value = suggested;
    notify(`Sugerido ${money(suggested)} para ganarle ${marginTarget}%`);
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

  // ─────────────────────────────────────────────────────────────
  // MI CATÁLOGO (beta): base de productos del kiosco con precio,
  // costo y margen. Guarda local al instante y sincroniza a Supabase
  // (tabla `catalogo`), con el mismo patrón offline-first del cierre manual.
  // ─────────────────────────────────────────────────────────────
  const CATALOG_STORAGE_KEY = 'kiosco_catalogo_v1';
  const SB_URL = 'https://pilfeptwylgufhbmmday.supabase.co';
  const SB_KEY = 'sb_publishable_AE6T1LMQuY2T8mf0uD_ANA_Bh4nk_ej';
  const cat = {
    tabSearch: document.getElementById('priceTabSearch'),
    tabCatalog: document.getElementById('priceTabCatalog'),
    viewSearch: document.getElementById('priceViewSearch'),
    viewCatalog: document.getElementById('priceViewCatalog'),
    count: document.getElementById('priceCatalogCount'),
    total: document.getElementById('catTotal'),
    sync: document.getElementById('catSyncStatus'),
    addBtn: document.getElementById('catAddBtn'),
    form: document.getElementById('catManualForm'),
    formTitle: document.getElementById('catFormTitle'),
    editUid: document.getElementById('catEditUid'),
    fNombre: document.getElementById('catNombre'),
    fCategoria: document.getElementById('catCategoria'),
    fCosto: document.getElementById('catCosto'),
    fPrecio: document.getElementById('catPrecio'),
    fUnidades: document.getElementById('catUnidades'),
    cancelBtn: document.getElementById('catCancelBtn'),
    list: document.getElementById('catList'),
    search: document.getElementById('catSearch'),
    categoryFilter: document.getElementById('catCategoryFilter'),
    summary: document.getElementById('catSummary'),
  };

  function catUid() { return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function catNum(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function readCatalog() {
    try { const all = JSON.parse(localStorage.getItem(CATALOG_STORAGE_KEY) || '{}'); return all && typeof all === 'object' ? all : {}; } catch { return {}; }
  }
  function writeCatalog(all) { try { localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(all)); } catch { /* persistencia bloqueada */ } }
  function catItems() { return Object.values(readCatalog()); }
  function catByEan(ean) { if (!ean) return null; const target = String(ean); return catItems().find(record => record.ean === target) || null; }
  function catMargin(record) {
    const sale = Number(record.precio), cost = Number(record.costo);
    if (!Number.isFinite(sale) || sale <= 0 || !Number.isFinite(cost) || cost <= 0) return null;
    return ((sale - cost) / sale) * 100;
  }
  function marginClass(margin) { if (!Number.isFinite(margin)) return ''; if (margin >= 25) return 'good'; if (margin >= 12) return 'warn'; return 'bad'; }
  function marginText(margin) { return Number.isFinite(margin) ? `${margin.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '—'; }

  async function catSbWrite(path, method, body, prefer) {
    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(await response.text());
    return response;
  }
  function catRecordToRow(record) {
    return {
      uid: record.uid, ean: record.ean || null, nombre: record.nombre || '',
      marca: record.marca || null, presentacion: record.presentacion || null,
      categoria: record.categoria || 'Kiosco varios',
      costo: Number(record.costo) || 0, precio: Number(record.precio) || 0,
      unidades_bulto: record.unidades ? Number(record.unidades) : null,
      imagen: record.imagen || null,
      origen: record.origen || 'manual', updated_at: record.savedAt || new Date().toISOString(),
    };
  }
  async function catSaveRemote(record) {
    await catSbWrite('catalogo?on_conflict=uid', 'POST', catRecordToRow(record), 'resolution=merge-duplicates,return=minimal');
  }
  async function catDeleteRemote(uid) {
    await catSbWrite(`catalogo?uid=eq.${encodeURIComponent(uid)}`, 'DELETE', undefined, 'return=minimal');
  }
  function catCountPending() { return catItems().filter(record => !record.synced).length; }
  function renderCatSyncStatus() {
    if (!cat.sync) return;
    const pending = catCountPending();
    if (pending > 0) { cat.sync.className = 'cat-sync-status pend'; cat.sync.textContent = '⟳ ' + pending + ' sin subir'; }
    else { cat.sync.className = 'cat-sync-status ok'; cat.sync.textContent = catItems().length ? '✓ Sincronizado' : ''; }
  }
  function updateCatalogCount() {
    const total = catItems().length;
    if (cat.count) cat.count.textContent = String(total);
    if (cat.total) cat.total.textContent = total + (total === 1 ? ' producto' : ' productos');
  }

  // Guarda un producto local al instante y lo sube a Supabase en segundo plano.
  function catUpsert(record, options = {}) {
    const all = readCatalog();
    if (!record.uid) record.uid = catUid();
    record.savedAt = new Date().toISOString();
    record.synced = false;
    all[record.uid] = { ...record };
    writeCatalog(all);
    updateCatalogCount();
    renderCatSyncStatus();
    if (options.rerender !== false) renderCatalog();
    const target = { ...record };
    catSaveRemote(target).then(() => {
      const current = readCatalog();
      if (current[target.uid]) { current[target.uid].synced = true; writeCatalog(current); renderCatSyncStatus(); }
    }).catch(() => { if (options.toast) notify('Guardado local. Se sube cuando haya conexión.'); });
    if (options.toast) notify(options.toast);
    return record;
  }

  async function catSyncLocal() {
    const all = readCatalog();
    let changed = false;
    for (const uid of Object.keys(all)) {
      const record = all[uid];
      if (!record || record.synced) continue;
      try { await catSaveRemote(record); record.synced = true; changed = true; } catch { /* se reintenta la próxima vez */ }
    }
    if (changed) writeCatalog(all);
    renderCatSyncStatus();
  }

  async function catLoadRemote() {
    try {
      const response = await fetch(`${SB_URL}/rest/v1/catalogo?select=*&order=categoria.asc,nombre.asc`, {
        cache: 'no-store', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
      if (!response.ok) throw new Error(await response.text());
      const rows = await response.json();
      const all = readCatalog();
      rows.forEach(row => {
        const local = all[row.uid];
        if (local && local.synced === false) return; // un cambio local sin subir tiene prioridad
        all[row.uid] = {
          uid: row.uid, ean: row.ean || null, nombre: row.nombre || '',
          marca: row.marca || '', presentacion: row.presentacion || '',
          categoria: row.categoria || 'Kiosco varios',
          costo: Number(row.costo) || 0, precio: Number(row.precio) || 0,
          unidades: row.unidades_bulto ? Number(row.unidades_bulto) : null,
          imagen: row.imagen || null,
          origen: row.origen || 'manual', savedAt: row.updated_at || new Date().toISOString(), synced: true,
        };
      });
      writeCatalog(all);
    } catch { /* sin conexión o tabla aún no creada: seguimos con lo local */ }
  }

  const CAT_ICONS = {
    'golosinas': '🍬', 'chocolates': '🍫', 'bebidas': '🥤', 'cigarrillos': '🚬',
    'almacén': '🛒', 'almacen': '🛒', 'fiambres y lácteos': '🧀', 'panificados': '🥐',
    'limpieza': '🧼', 'perfumería': '🧴', 'perfumeria': '🧴', 'librería': '📚',
    'libreria': '📚', 'regalería': '🎁', 'regaleria': '🎁', 'kiosco varios': '🏪',
  };
  function catIcon(record) {
    return CAT_ICONS[String(record.categoria || '').trim().toLowerCase()] || '🏪';
  }
  function catThumbHtml(record) {
    const icon = catIcon(record);
    if (record.imagen && /^https:\/\//.test(record.imagen)) {
      return `<div class="cat-thumb"><img src="${escapeHtml(record.imagen)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${icon}'"></div>`;
    }
    return `<div class="cat-thumb">${icon}</div>`;
  }

  // Busca la foto en MercadoLibre para un producto cargado a mano
  // (en segundo plano; si no hay clave ML o falla, queda el ícono de categoría).
  function catFetchFoto(record) {
    if (!record || record.imagen) return;
    apiRequest({ action: 'foto', q: record.nombre }).then(data => {
      if (!data?.image) return;
      const all = readCatalog();
      const current = all[record.uid];
      if (!current || current.imagen) return;
      current.imagen = data.image;
      catUpsert(current, { rerender: !cat.viewCatalog || !cat.viewCatalog.hidden });
    }).catch(() => { /* sin foto: el ícono de categoría alcanza */ });
  }

  function catGroups(items) {
    const groups = {};
    items.forEach(record => { const key = record.categoria || 'Kiosco varios'; (groups[key] = groups[key] || []).push(record); });
    return Object.keys(groups).sort((a, b) => a.localeCompare(b, 'es')).map(category => ({
      category,
      rows: groups[category].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')),
    }));
  }

  function updateCategoryFilter(items) {
    if (!cat.categoryFilter) return;
    const selected = cat.categoryFilter.value;
    const categories = [...new Set(items.map(record => record.categoria || 'Kiosco varios'))].sort((a, b) => a.localeCompare(b, 'es'));
    cat.categoryFilter.innerHTML = '<option value="">Todas las categorías</option>'
      + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    if (categories.includes(selected)) cat.categoryFilter.value = selected;
  }

  function renderCatalogSummary(items) {
    if (!cat.summary) return;
    const margins = items.map(catMargin).filter(Number.isFinite);
    const average = margins.length ? margins.reduce((sum, value) => sum + value, 0) / margins.length : null;
    const withoutCost = items.filter(record => !(Number(record.costo) > 0)).length;
    cat.summary.innerHTML = `
      <div class="cat-summary-item"><div class="cat-summary-label">Productos</div><div class="cat-summary-value">${items.length}</div></div>
      <div class="cat-summary-item"><div class="cat-summary-label">Margen promedio real</div><div class="cat-summary-value ${Number.isFinite(average) ? marginClass(average) : ''}">${marginText(average)}</div></div>
      <div class="cat-summary-item"><div class="cat-summary-label">Sin costo real</div><div class="cat-summary-value ${withoutCost ? 'warn' : 'good'}">${withoutCost}</div></div>`;
  }

  function renderCatalog() {
    if (!cat.list) return;
    const allItems = catItems();
    updateCategoryFilter(allItems);
    renderCatalogSummary(allItems);
    if (!allItems.length) {
      cat.list.innerHTML = '<div class="cat-empty"><strong>Tu catálogo está vacío</strong><span>Guardá tu precio y costo desde “Buscar precios”, o tocá “Agregar producto” para cargar librería y todo lo que no esté en Precios Claros.</span></div>';
      return;
    }
    const query = catalogText(cat.search?.value || '').trim();
    const category = cat.categoryFilter?.value || '';
    const items = allItems.filter(record => {
      if (category && (record.categoria || 'Kiosco varios') !== category) return false;
      if (!query) return true;
      return catalogText([record.nombre, record.marca, record.presentacion, record.categoria, record.ean].filter(Boolean).join(' ')).includes(query);
    });
    if (!items.length) {
      cat.list.innerHTML = '<div class="cat-empty"><strong>Sin coincidencias</strong><span>Probá con otro nombre, marca, EAN o categoría.</span></div>';
      return;
    }
    cat.list.innerHTML = catGroups(items).map(group => {
      const margins = group.rows.map(catMargin).filter(Number.isFinite);
      const avg = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null;
      const meta = `${group.rows.length} ${group.rows.length === 1 ? 'producto' : 'productos'}${Number.isFinite(avg) ? ` · margen prom. ${marginText(avg)}` : ''}`;
      const rows = group.rows.map(record => {
        const margin = catMargin(record);
        const sub = [record.marca, record.presentacion].filter(Boolean).join(' · ');
        const origenTexto = { manual: 'manual', preciosclaros: 'Precios Claros', mercadolibre: 'Mercado Libre', 'casa-paso': 'Casa Paso', 'dulce-sur': 'Dulce Sur', rappi: 'Rappi', open25: 'Open 25' }[record.origen] || 'manual';
        const origen = `<span class="cat-origin">${origenTexto}</span>`;
        return `<div class="cat-row" data-uid="${escapeHtml(record.uid)}">
          ${catThumbHtml(record)}
          <div class="cat-row-main">
            <div class="cat-row-name">${escapeHtml(record.nombre)}</div>
            <div class="cat-row-brand">${sub ? escapeHtml(sub) + ' · ' : ''}${origen}</div>
          </div>
          <div class="cat-cell cat-cell-costo"><div class="cat-cell-label">Costo</div><div class="cat-cell-value">${record.costo ? money(record.costo) : '—'}</div></div>
          <div class="cat-cell"><div class="cat-cell-label">Venta</div><div class="cat-cell-value">${record.precio ? money(record.precio) : '—'}</div></div>
          <div class="cat-cell"><div class="cat-cell-label">Margen</div><div class="cat-cell-value margin ${marginClass(margin)}">${marginText(margin)}</div></div>
          <div class="cat-row-actions">
            <button class="cat-icon-btn edit" type="button" data-uid="${escapeHtml(record.uid)}" title="Editar" aria-label="Editar producto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="cat-icon-btn del" type="button" data-uid="${escapeHtml(record.uid)}" title="Eliminar" aria-label="Eliminar producto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
          </div>
        </div>`;
      }).join('');
      return `<div class="cat-group"><div class="cat-group-head"><span class="cat-group-name">${escapeHtml(group.category)}</span><span class="cat-group-meta">${meta}</span></div>${rows}</div>`;
    }).join('');
  }

  function openManualForm(record) {
    if (!cat.form) return;
    cat.form.hidden = false;
    cat.addBtn.textContent = 'Cerrar formulario';
    cat.addBtn.classList.add('close');
    cat.editUid.value = record?.uid || '';
    cat.formTitle.textContent = record ? 'Editar producto' : 'Nuevo producto';
    cat.fNombre.value = record?.nombre || '';
    cat.fCategoria.value = record?.categoria || '';
    cat.fCosto.value = record && record.costo ? record.costo : '';
    cat.fPrecio.value = record && record.precio ? record.precio : '';
    cat.fUnidades.value = record && record.unidades ? record.unidades : '';
    setTimeout(() => cat.fNombre.focus(), 40);
  }
  function closeManualForm() {
    if (!cat.form) return;
    cat.form.hidden = true;
    cat.form.reset();
    cat.editUid.value = '';
    cat.addBtn.textContent = '+ Agregar producto';
    cat.addBtn.classList.remove('close');
  }

  function showCatalogView(showCatalog) {
    if (!cat.viewSearch || !cat.viewCatalog) return;
    cat.viewSearch.hidden = showCatalog;
    cat.viewCatalog.hidden = !showCatalog;
    cat.tabSearch.classList.toggle('active', !showCatalog);
    cat.tabCatalog.classList.toggle('active', showCatalog);
    cat.tabSearch.setAttribute('aria-selected', String(!showCatalog));
    cat.tabCatalog.setAttribute('aria-selected', String(showCatalog));
    if (showCatalog) { updateCatalogCount(); renderCatSyncStatus(); renderCatalog(); }
  }

  if (cat.tabSearch && cat.tabCatalog) {
    cat.tabSearch.addEventListener('click', () => showCatalogView(false));
    cat.tabCatalog.addEventListener('click', () => showCatalogView(true));
    cat.search?.addEventListener('input', renderCatalog);
    cat.categoryFilter?.addEventListener('change', renderCatalog);
    cat.addBtn.addEventListener('click', () => { if (cat.form.hidden) openManualForm(null); else closeManualForm(); });
    cat.cancelBtn.addEventListener('click', closeManualForm);
    cat.fNombre.addEventListener('blur', () => {
      if (!cat.fCategoria.value.trim() && cat.fNombre.value.trim()) {
        cat.fCategoria.value = inferCategory(cat.fNombre.value, '');
      }
    });
    cat.form.addEventListener('submit', event => {
      event.preventDefault();
      const nombre = cat.fNombre.value.trim();
      const editUid = cat.editUid.value || undefined;
      const existing = editUid ? readCatalog()[editUid] : null;
      const categoria = cat.fCategoria.value.trim() || inferCategory(nombre, existing?.marca || '');
      const precio = catNum(cat.fPrecio.value);
      const costo = catNum(cat.fCosto.value);
      const unitsRaw = Number(cat.fUnidades.value);
      const unidades = Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.round(unitsRaw) : null;
      if (!nombre) { cat.fNombre.focus(); notify('Poné el nombre del producto'); return; }
      if (!precio) { cat.fPrecio.focus(); notify('Poné el precio de venta'); return; }
      const saved = catUpsert({
        uid: editUid,
        ean: existing ? existing.ean : null,
        nombre,
        marca: existing ? existing.marca : '',
        presentacion: existing ? existing.presentacion : '',
        categoria, costo: costo || 0, precio, unidades,
        imagen: existing ? existing.imagen : null,
        origen: existing ? existing.origen : 'manual',
      }, { toast: editUid ? 'Producto actualizado ✓' : 'Producto agregado ✓' });
      closeManualForm();
      catFetchFoto(saved);
    });
    document.getElementById('catSugerirBtn')?.addEventListener('click', () => {
      const cost = catNum(cat.fCosto.value);
      if (!cost) { cat.fCosto.focus(); notify('Cargá el costo para sugerir el precio'); return; }
      const marginTarget = Number(document.getElementById('catMargenObj').value) || 30;
      if (marginTarget <= 0 || marginTarget >= 95) { notify('El margen tiene que estar entre 1 y 94%'); return; }
      const suggested = suggestPrice(cost, marginTarget);
      cat.fPrecio.value = suggested;
      notify(`Sugerido ${money(suggested)} para ganarle ${marginTarget}%`);
    });
    cat.list.addEventListener('click', event => {
      const editBtn = event.target.closest('.cat-icon-btn.edit');
      const delBtn = event.target.closest('.cat-icon-btn.del');
      if (editBtn) {
        const record = readCatalog()[editBtn.dataset.uid];
        if (record) { openManualForm(record); cat.form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        return;
      }
      if (delBtn) {
        const uid = delBtn.dataset.uid;
        const record = readCatalog()[uid];
        if (!record) return;
        if (!window.confirm(`¿Eliminar “${record.nombre}” del catálogo?`)) return;
        const all = readCatalog();
        delete all[uid];
        writeCatalog(all);
        renderCatalog();
        updateCatalogCount();
        renderCatSyncStatus();
        catDeleteRemote(uid).catch(() => notify('Borrado local. Supabase no respondió.'));
      }
    });
    // Al abrir la referencia: refrescamos contador, subimos pendientes y traemos lo remoto.
    openButton.addEventListener('click', () => {
      updateCatalogCount();
      renderCatSyncStatus();
      catSyncLocal();
      catLoadRemote().then(() => {
        updateCatalogCount();
        renderCatSyncStatus();
        if (!cat.viewCatalog.hidden) renderCatalog();
      });
    });
    updateCatalogCount();
  }

  syncLocationControl();
})();
