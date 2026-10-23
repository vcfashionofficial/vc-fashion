(() => {
  let products=[];
  const {money,imageUrl,isWishlisted}=window.FormeCommerce;
  const grid=document.getElementById('shop-product-grid');
  const filterForm=document.querySelector('.filter-sidebar');
  let searchText='';
  const wishlistOnly=new URLSearchParams(window.location.search).get('wishlist')==='1';
  const checked=name=>[...filterForm.querySelectorAll(`input[name="${name}"]:checked`)].map(input=>input.value);
  const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

  function safeProductText(value){
    return value == null ? '' : String(value).trim();
  }

  function renderCategories(restore=[]) {
    const categories = window.FORME_CATEGORIES?.length ? window.FORME_CATEGORIES : [...new Set(products.map(product => product.category).filter(Boolean))].map((name, index) => ({ id: index, name, slug: name.toLowerCase() }));
    document.getElementById('category-options').innerHTML = categories.map(category => {
      const name = safeProductText(category.name);
      const count = products.filter(product => safeProductText(product.category) === name).length;
      const checked = restore.includes(name) || restore.includes(String(category.slug || '').toLowerCase());
      return `<label><input type="checkbox" name="category" value="${escapeHtml(name)}" ${checked ? 'checked' : ''}> ${escapeHtml(name)} <span>${String(count).padStart(2, '0')}</span></label>`;
    }).join('');
  }

  function renderColors(){
    const selected = checked('color');
    const colors = new Map();
    products.forEach(product => {
      const productColors = Array.isArray(product.colors) ? product.colors : [];
      const colorNames = Array.isArray(product.colorNames) ? product.colorNames : [];
      productColors.forEach((hex, index) => {
        const name = safeProductText(colorNames[index] || productColors[index]);
        if (name && !colors.has(name)) colors.set(name, hex || '#d9d3c9');
      });
    });
    document.getElementById('color-options').innerHTML = [...colors].map(([name, hex]) => `<label><input type="checkbox" name="color" value="${escapeHtml(name)}" ${selected.includes(name) ? 'checked' : ''}><span class="color-chip" style="background:${hex}" aria-hidden="true"></span>${escapeHtml(name)}</label>`).join('');
  }

  function renderSizes(restore=checked('size')){
    const sizes = [...new Set(products.flatMap(product => Array.isArray(product.sizes) ? product.sizes : []).filter(Boolean))];
    document.getElementById('size-options').innerHTML = sizes.map(size => `<label><input type="checkbox" name="size" value="${escapeHtml(size)}" ${restore.includes(size) ? 'checked' : ''}><span>${escapeHtml(size)}</span></label>`).join('');
  }

  function card(product){
    const safePrice = Number(product.price) || 0;
    const safeOldPrice = Number(product.oldPrice) || null;
    const hasDiscount = Number.isFinite(safeOldPrice) && safeOldPrice > safePrice && safePrice > 0;
    const oldPrice = hasDiscount ? `<span class="old-price">${money(safeOldPrice)}</span>` : '';
    const discount = hasDiscount ? Math.round(((safeOldPrice - safePrice) / safeOldPrice) * 100) : 0;
    const badge = discount ? `${discount}% OFF` : safeProductText(product.badge) || 'Featured';
    const name = escapeHtml(safeProductText(product.name));
    const swatches = (Array.isArray(product.colors) ? product.colors : []).map((hex, index) => `<span class="swatch" title="${escapeHtml(safeProductText(product.colorNames?.[index] || 'Colour'))}" style="background:${hex || '#d9d3c9'}"></span>`).join('');
    const saved = isWishlisted(product.id);
    const rating = Number(product.rating);
    const ratingMarkup = Number.isFinite(rating) && rating > 0 ? `<span class="product-rating"><span aria-hidden="true">★</span> ${rating.toFixed(1)}</span>` : '';
    const imageSrc = product.imageUrl || imageUrl(product.image);
    const defaultSize = safeProductText(product.defaultSize || 'M');
    const defaultColor = Array.isArray(product.colors) && product.colors.length ? product.colors[0] : '';
    const addLabel = product.inStock === false ? 'Sold out' : 'Add to bag';
    return `<article class="product-card"><div class="product-image"><span class="product-badge">${escapeHtml(badge)}</span><a class="product-image-link" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${name}"><img src="${imageSrc}" alt="${name}" width="600" height="760" loading="lazy" decoding="async"></a><button class="share-product-button" type="button" data-share-product="${escapeHtml(product.id)}" data-share-name="${name}" data-share-price="${safePrice}" aria-label="Share ${name}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2"></path></svg></button><button class="wishlist-button${saved ? ' is-saved' : ''}" type="button" data-wishlist="${product.id}" aria-label="${saved ? 'Remove' : 'Add'} ${name} ${saved ? 'from' : 'to'} wishlist" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button><button class="quick-add" type="button" data-add-cart="${product.id}" data-size="${defaultSize}" data-color="${defaultColor}" ${product.inStock === false ? 'disabled' : ''}>${addLabel} <span aria-hidden="true">+</span></button></div><div class="product-info"><div class="product-topline"><a class="product-name product-name-link" href="product.html?id=${encodeURIComponent(product.id)}">${name}</a>${ratingMarkup}</div><div class="product-meta"><span class="product-price">${money(safePrice)}${oldPrice}</span><span class="product-swatches" aria-label="Available colours">${swatches}</span></div></div></article>`;
  }

  function filteredProducts(){
    const categories = checked('category');
    const prices = checked('price');
    const sizes = checked('size');
    const colors = checked('color');
    const sort = document.getElementById('sort-products').value;

    let result = products.filter(product => {
      if (wishlistOnly && !isWishlisted(product.id)) return false;

      const searchableText = [
        safeProductText(product.name),
        safeProductText(product.category),
        safeProductText(product.badge),
        safeProductText(product.description),
        safeProductText(product.material),
        ...(Array.isArray(product.colorNames) ? product.colorNames : []),
        ...(Array.isArray(product.sizes) ? product.sizes : [])
      ].filter(Boolean).join(' ').toLowerCase();

      if (searchText && !searchableText.includes(searchText)) return false;
      if (categories.length && !categories.includes(safeProductText(product.category))) return false;
      if (prices.length && !prices.some(range => {
        const price = Number(product.price) || 0;
        if (range === 'under-1000') return price < 1000;
        if (range === '1000-2000') return price >= 1000 && price <= 2000;
        return price > 2000;
      })) return false;
      if (sizes.length && !sizes.some(size => (Array.isArray(product.sizes) ? product.sizes : []).includes(size))) return false;
      if (colors.length && !colors.some(color => (Array.isArray(product.colorNames) ? product.colorNames : []).includes(color))) return false;
      return true;
    });

    if (sort === 'price-asc') result.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    if (sort === 'price-desc') result.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    if (sort === 'newest') result.sort((a, b) => Number(b.isNew) - Number(a.isNew));
    if (sort === 'popular') result.sort((a, b) => (Number(b.best) || 0) - (Number(a.best) || 0) || (Number(b.rating) || 0) - (Number(a.rating) || 0));
    return result;
  }

  function render(){
    const result = filteredProducts();
    const emptyWishlist = wishlistOnly && products.every(product => !isWishlisted(product.id));
    grid.innerHTML = result.map(card).join('');
    document.getElementById('result-count').textContent = result.length;
    const emptyState = document.getElementById('shop-no-results');
    emptyState.hidden = result.length > 0;
    const catalogUnavailable = window.FORME_CATALOG_SOURCE === 'unavailable';
    emptyState.querySelector('h2').textContent = catalogUnavailable ? 'Collection unavailable.' : emptyWishlist ? 'Your wishlist is empty.' : 'No pieces found.';
    emptyState.querySelector('p').textContent = catalogUnavailable ? 'Please try again later.' : emptyWishlist ? 'Save a piece with its heart button and it will appear here.' : 'Try changing your search or clearing a filter.';
    emptyState.querySelector('button').hidden = catalogUnavailable || emptyWishlist;
    grid.hidden = result.length === 0;
    const selectedFilterCount = [...filterForm.querySelectorAll('input:checked')].length;
    const count = selectedFilterCount + (searchText ? 1 : 0);
    document.getElementById('active-filter-label').textContent = count ? `· ${count} filter${count === 1 ? '' : 's'} applied` : '';
    const filterCount = document.getElementById('filter-count');
    filterCount.textContent = selectedFilterCount;
    filterCount.hidden = selectedFilterCount === 0;
  }

  function clearFilters(){
    categoryFilterChanged = true;
    filterForm.querySelectorAll('input:checked').forEach(input => input.checked = false);
    const shopSearch = document.getElementById('shop-search');
    if (shopSearch) shopSearch.value = '';
    const sortSelect = document.getElementById('sort-products');
    if (sortSelect) sortSelect.value = 'featured';
    searchText = '';
    syncSearchControls();
    render();
  }

  function closeFilterSheet(returnFocus=true){
    if(!filterForm.classList.contains('is-open'))return;
    filterForm.classList.remove('is-open');
    document.getElementById('filter-backdrop').hidden=true;
    document.body.classList.remove('filter-sheet-open');
    const trigger=document.getElementById('filter-trigger');
    trigger.setAttribute('aria-expanded','false');
    filterForm.setAttribute('aria-hidden',String(mobileSearch.matches));
    filterForm.setAttribute('aria-modal','false');
    if(returnFocus&&mobileSearch.matches)trigger.focus();
  }

  function openFilterSheet(){
    if(!mobileSearch.matches||wishlistOnly)return;
    const trigger=document.getElementById('filter-trigger');
    filterForm.classList.add('is-open');
    filterForm.setAttribute('aria-hidden','false');
    filterForm.setAttribute('aria-modal','true');
    trigger.setAttribute('aria-expanded','true');
    document.getElementById('filter-backdrop').hidden=false;
    document.body.classList.add('filter-sheet-open');
    document.getElementById('filter-close').focus();
  }

  renderCategories();
  renderColors();
  renderSizes();
  const params=new URLSearchParams(window.location.search);
  const initialCategory=params.get('category');
  let categoryFilterChanged=false;
  function applyInitialCategory(){
    if(!initialCategory||categoryFilterChanged)return;
    const category=(window.FORME_CATEGORIES||[]).find(item=>item.name.toLowerCase()===initialCategory.toLowerCase()||item.slug.toLowerCase()===initialCategory.toLowerCase());
    if(!category)return;
    const categoryInput=[...filterForm.querySelectorAll('input[name="category"]')].find(input=>input.value===category.name);
    if(categoryInput)categoryInput.checked=true;
  }
  if(wishlistOnly){
    document.querySelector('.wishlist-back-row').hidden=false;
    document.getElementById('wishlist-back-button').addEventListener('click',()=>{
      try{
        const previousPage=new URL(document.referrer);
        if(previousPage.origin===window.location.origin&&previousPage.href!==window.location.href){
          window.history.back();
          return;
        }
      }catch{}
      window.location.assign('index.html');
    });
    document.querySelector('.shop-intro h1').innerHTML='Your <em>wishlist.</em>';
    document.querySelector('.shop-intro>p').textContent='The pieces you have saved for later.';
    filterForm.hidden=true;
    document.getElementById('filter-trigger').hidden=true;
    document.querySelector('.mobile-bottom-nav [aria-current="page"]')?.removeAttribute('aria-current');
    document.querySelector('.mobile-bottom-nav a[href="shop.html?wishlist=1"]')?.setAttribute('aria-current','page');
  }
  applyInitialCategory();
  const initialQuery=params.get('q');
  if(initialQuery){searchText=initialQuery.toLowerCase();document.getElementById('shop-search').value=initialQuery;}
  const searchForm=document.getElementById('shop-search-form'),searchInput=document.getElementById('shop-search'),searchButton=searchForm.querySelector('.search-button');
  const mobileSearch=window.matchMedia('(max-width: 680px)');
  const syncFilterMode=()=>{
    filterForm.setAttribute('role',mobileSearch.matches?'dialog':'complementary');
    filterForm.setAttribute('aria-modal','false');
    filterForm.setAttribute('aria-hidden',String(mobileSearch.matches&&!filterForm.classList.contains('is-open')));
    if(!mobileSearch.matches)closeFilterSheet(false);
  };
  const syncSearchMode=()=>{
    if(mobileSearch.matches){searchInput.tabIndex=-1;searchInput.setAttribute('aria-hidden','true');}
    else{searchInput.removeAttribute('tabindex');searchInput.removeAttribute('aria-hidden');}
  };
  const syncSearchControls=()=>{searchForm.querySelector('.search-clear').hidden=!searchInput.value;searchForm.classList.toggle('has-value',Boolean(searchInput.value));};
  syncSearchMode();syncFilterMode();mobileSearch.addEventListener('change',syncSearchMode);mobileSearch.addEventListener('change',syncFilterMode);
  syncSearchControls();
  render();
  window.FORME_CATALOG_READY?.then(loadedProducts=>{
    const selectedCategories=checked('category');
    products=Array.isArray(loadedProducts)?loadedProducts:[];
    renderCategories(selectedCategories);
    renderColors();
    renderSizes(checked('size'));
    applyInitialCategory();
    render();
  });
  filterForm.addEventListener('change',event=>{if(event.target.name==='category')categoryFilterChanged=true;render();});
  searchForm.addEventListener('submit',event=>{event.preventDefault();searchText=searchInput.value.trim().toLowerCase();render();});
  searchInput.addEventListener('input',event=>{searchText=event.target.value.trim().toLowerCase();syncSearchControls();render();});
  searchForm.querySelector('.search-clear').addEventListener('click',()=>{searchInput.value='';searchInput.dispatchEvent(new Event('input',{bubbles:true}));searchInput.focus();});
  document.getElementById('sort-products').addEventListener('change',render);
  document.getElementById('clear-filters').addEventListener('click',clearFilters);
  document.getElementById('reset-empty-filters').addEventListener('click',clearFilters);
  document.getElementById('filter-trigger').addEventListener('click',openFilterSheet);
  document.getElementById('filter-close').addEventListener('click',()=>closeFilterSheet());
  document.getElementById('filter-backdrop').addEventListener('click',()=>closeFilterSheet());
  document.getElementById('apply-filters').addEventListener('click',()=>{render();closeFilterSheet();});
  filterForm.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||!filterForm.classList.contains('is-open'))return;
    const focusable=[...filterForm.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(element=>!element.hidden);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFilterSheet();});
  window.addEventListener('forme:wishlist',render);
  function searchPageHref(){
    const params=new URLSearchParams();
    params.set('return',window.location.pathname+window.location.search+window.location.hash);
    if(searchInput.value.trim())params.set('q',searchInput.value.trim());
    return `search.html?${params.toString()}`;
  }
  searchButton.addEventListener('click',event=>{
    if(mobileSearch.matches){
      event.preventDefault();window.location.href=searchPageHref();
    }
  });
  document.getElementById('menu-toggle').addEventListener('click',event=>{
    const button=event.currentTarget,open=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!open));document.getElementById('main-nav').classList.toggle('is-open',!open);
  });
  document.querySelectorAll('#main-nav a').forEach(link=>link.addEventListener('click',()=>{
    document.getElementById('menu-toggle').setAttribute('aria-expanded','false');document.getElementById('main-nav').classList.remove('is-open');
  }));
})();
