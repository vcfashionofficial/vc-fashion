(() => {
  const input = document.getElementById('search-page-input');
  const form = document.getElementById('search-page-form');
  const clearButton = document.getElementById('search-page-clear');
  const resultsNode = document.getElementById('search-results');
  const emptyNode = document.getElementById('search-empty-state');
  const heading = document.getElementById('search-results-title');
  const resultCount = document.getElementById('search-result-count');
  const recentSection = document.getElementById('recent-searches-section');
  const recentList = document.getElementById('recent-searches-list');
  const recentStorageKey = 'forme-recent-searches';
  const params = new URLSearchParams(window.location.search);
  let products = window.FORME_PRODUCTS || [];
  let recentSearches = readRecentSearches();

  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const money = value => window.FormeCommerce.money(value);
  const image = product => product.imageUrl || window.FormeCommerce.imageUrl(product.image,360);
  const searchableText = product => [product.name,product.category,product.badge,product.description,product.material,...(product.colorNames||[]),...(product.sizes||[])].filter(Boolean).join(' ').toLowerCase();

  function readRecentSearches() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(recentStorageKey) || '[]');
      if (!Array.isArray(stored)) return [];
      const seen = new Set();
      return stored.filter(value => {
        if (typeof value !== 'string' || !value.trim()) return false;
        const key = value.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(value => value.trim()).slice(0,8);
    } catch { return []; }
  }

  function persistRecentSearches() {
    try { window.localStorage.setItem(recentStorageKey,JSON.stringify(recentSearches)); } catch {}
  }

  function addRecentSearch(query) {
    const clean = query.trim();
    if (!clean) return;
    recentSearches = recentSearches.filter(item => item.toLowerCase() !== clean.toLowerCase());
    recentSearches.unshift(clean);
    recentSearches = recentSearches.slice(0,8);
    persistRecentSearches();
    renderRecentSearches();
  }

  function renderRecentSearches() {
    recentList.replaceChildren();
    recentSearches.forEach(query => {
      const item = document.createElement('li');
      item.className = 'recent-search-item';
      const select = document.createElement('button');
      select.className = 'recent-search-query';
      select.type = 'button';
      select.dataset.recentQuery = query;
      select.textContent = query;
      select.setAttribute('aria-label',`Search again for ${query}`);
      const remove = document.createElement('button');
      remove.className = 'recent-search-remove';
      remove.type = 'button';
      remove.dataset.removeRecent = query;
      remove.setAttribute('aria-label',`Remove ${query} from recent searches`);
      remove.innerHTML = '<span aria-hidden="true">×</span>';
      item.append(select,remove);
      recentList.append(item);
    });
    recentSection.hidden = recentSearches.length === 0 || Boolean(input.value.trim());
  }
  persistRecentSearches();

  function card(product) {
    const name = escapeHtml(product.name);
    const category = escapeHtml(product.category || 'VC FASHION');
    const colors = (product.colorNames || []).slice(0,3).map(escapeHtml).join(' · ');
    const detail = colors ? `${category} · ${colors}` : category;
    return `<article class="search-result-card"><a class="search-result-link" href="product.html?id=${encodeURIComponent(product.id)}"><img src="${escapeHtml(image(product))}" alt="${name}" loading="lazy"><span class="search-result-copy"><strong>${name}</strong><small>${detail}</small><span class="search-result-price">${money(product.price)}</span></span><span class="search-result-arrow" aria-hidden="true">&rarr;</span></a><button class="share-product-button" type="button" data-share-product="${escapeHtml(product.id)}" data-share-name="${name}" data-share-price="${Number(product.price)||0}" aria-label="Share ${name}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2"></path></svg></button></article>`;
  }

  function updateUrl(query) {
    const next = new URL(window.location.href);
    if (query) next.searchParams.set('q',query);
    else next.searchParams.delete('q');
    window.history.replaceState(null,'',`${next.pathname}${next.search}${next.hash}`);
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    const matching = products.filter(product => !query || searchableText(product).includes(query));
    const suggestions = query ? matching : [...matching].sort((a,b) => Number(b.isNew)-Number(a.isNew)).slice(0,6);
    resultsNode.innerHTML = suggestions.map(card).join('');
    emptyNode.hidden = suggestions.length > 0;
    heading.textContent = query ? 'Search results' : 'Suggested pieces';
    resultCount.textContent = query ? `${matching.length} ${matching.length===1?'piece':'pieces'}` : `${suggestions.length} suggestions`;
    clearButton.hidden = !input.value;
    renderRecentSearches();
    updateUrl(query);
  }

  function submitQuery(query = input.value) {
    input.value = query.trim();
    addRecentSearch(input.value);
    render();
    input.focus();
  }

  function clearQuery() {
    input.value='';
    render();
    input.focus();
  }

  function safeReturnTarget() {
    const requested = params.get('return');
    if (!requested) return null;
    try {
      const target = new URL(requested,window.location.origin);
      if (target.origin !== window.location.origin || target.pathname === window.location.pathname) return null;
      return target.href;
    } catch { return null; }
  }

  document.getElementById('search-back').addEventListener('click',() => {
    const target = safeReturnTarget();
    if (target) { window.location.replace(target); return; }
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin && referrer.pathname !== window.location.pathname) { window.history.back(); return; }
    } catch {}
    window.location.replace('index.html');
  });

  form.addEventListener('submit',event => { event.preventDefault(); submitQuery(); });
  input.addEventListener('input',render);
  clearButton.addEventListener('click',clearQuery);
  document.getElementById('search-empty-clear').addEventListener('click',clearQuery);
  document.getElementById('recent-searches-clear-all').addEventListener('click',() => {
    recentSearches=[];persistRecentSearches();renderRecentSearches();
  });
  recentList.addEventListener('click',event => {
    const remove = event.target.closest('[data-remove-recent]');
    if (remove) {
      const query=remove.dataset.removeRecent;
      recentSearches=recentSearches.filter(item=>item.toLowerCase()!==query.toLowerCase());
      persistRecentSearches();renderRecentSearches();return;
    }
    const select = event.target.closest('[data-recent-query]');
    if (select) submitQuery(select.dataset.recentQuery);
  });
  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || !input.value || document.getElementById('cart-drawer').classList.contains('is-open')) return;
    event.preventDefault();
    clearQuery();
  },true);
  resultsNode.addEventListener('click',event => {
    if (event.target.closest('.search-result-card') && input.value.trim()) addRecentSearch(input.value);
  });

  const initialQuery = params.get('q') || '';
  input.value = initialQuery;
  render();
  requestAnimationFrame(() => input.focus({preventScroll:true}));

  window.FORME_CATALOG_READY?.then(loaded => {
    if (Array.isArray(loaded)) { products=loaded; render(); }
  });
})();
