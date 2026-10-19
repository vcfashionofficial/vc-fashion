// Homepage catalogue and lightweight storefront interactions.
let products = [];

const formatPrice = value => `₹${value.toLocaleString('en-IN')}`;
const imageUrl = (id, width=800) => /^https?:\/\//i.test(id || '') ? id : `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=78`;
const productImageUrl = (product, width=800) => product.imageUrl || imageUrl(product.image, width);
let activeSearch = '';
let activeCategory = '';

const newGrid = document.getElementById('new-arrivals-grid');
const bestGrid = document.getElementById('best-sellers-grid');

function renderHomeCategoryChips() {
  const container = document.getElementById('home-filter-chips');
  if (!container) return;
  const available = [...new Set(products.map(product => product.category).filter(Boolean))];
  const preferredOrder = ['Men','Women','Kids'];
  const categories = [
    ...preferredOrder.filter(category => available.includes(category)),
    ...available.filter(category => !preferredOrder.includes(category)).sort((a,b) => a.localeCompare(b))
  ];
  if (activeCategory && !categories.includes(activeCategory)) activeCategory = '';
  const escapeAttribute = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  container.innerHTML = `<button type="button" data-home-category="" aria-pressed="${activeCategory ? 'false' : 'true'}">All</button>${categories.map(category => {
    const safeCategory = escapeAttribute(category);
    return `<button type="button" data-home-category="${safeCategory}" aria-pressed="${activeCategory === category}">${safeCategory}</button>`;
  }).join('')}`;
}

function productCard(product) {
  const {isWishlisted} = window.FormeCommerce;
  const saved = isWishlisted(product.id);
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const swatches = colors.map(color => `<span class="swatch" style="background:${color}" aria-hidden="true"></span>`).join('');
  const oldPrice = product.oldPrice ? `<span class="old-price">${formatPrice(product.oldPrice)}</span>` : '';
  const label = product.inStock === false ? 'Sold out' : product.badge.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const name = product.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const defaultSize = product.defaultSize && sizes.includes(product.defaultSize) ? product.defaultSize : (sizes.includes('M') ? 'M' : sizes[0]);
  const defaultColor = product.defaultColor && colors.includes(product.defaultColor) ? product.defaultColor : colors[0];
  const defaultVariant = (product.variants || []).find(variant => variant.size === defaultSize && variant.color_hex === defaultColor);
  const hasDefaultSelection = Boolean(defaultSize && defaultColor && sizes.includes(defaultSize) && colors.includes(defaultColor));
  const validStock = product.source !== 'supabase' || (defaultVariant && Number.isInteger(Number(defaultVariant.stock)) && Number(defaultVariant.stock) > 0);
  const available = product.inStock !== false && validStock;
  const hasAvailableVariant = (product.variants || []).some(variant => Number.isInteger(Number(variant.stock)) && Number(variant.stock) > 0);
  const productUrl = `product.html?id=${encodeURIComponent(product.id)}`;
  const cardAction = product.inStock === false
    ? `<button class="quick-add" type="button" disabled aria-label="Sold out: ${name}">Sold out</button>`
    : hasDefaultSelection && available
      ? `<button class="quick-add" type="button" data-add-cart="${product.id}" data-size="${defaultSize}" data-color="${defaultColor}" aria-label="Add ${name} to bag">Add to bag <span aria-hidden="true">+</span></button>`
      : product.source === 'supabase' && !hasAvailableVariant
        ? `<button class="quick-add" type="button" disabled aria-label="Sold out: ${name}">Sold out</button>`
        : `<a class="quick-add" href="${productUrl}" aria-label="Choose options for ${name}">Choose options <span aria-hidden="true">&rarr;</span></a>`;
  return `<article class="product-card">
    <div class="product-image"><span class="product-badge">${label}</span><a class="product-image-link" href="${productUrl}" aria-label="View ${name}"><img src="${productImageUrl(product)}" alt="${name}" loading="lazy"></a><button class="wishlist-button${saved?' is-saved':''}" type="button" data-wishlist="${product.id}" aria-label="${saved?'Remove':'Add'} ${name} ${saved?'from':'to'} wishlist" aria-pressed="${saved}">${saved?'♥':'♡'}</button>${cardAction}</div>
    <div class="product-info"><div class="product-topline"><a class="product-name product-name-link" href="product.html?id=${encodeURIComponent(product.id)}">${name}</a><span class="product-rating"><span>★</span> ${product.rating}</span></div><div class="product-meta"><span class="product-price">${formatPrice(product.price)}${oldPrice}</span><span class="product-swatches" aria-label="Available colours">${swatches}</span></div></div>
  </article>`;
}

function renderProducts() {
  const matching = products.filter(product => {
    const searchableText = [product.name,product.category,product.badge,product.description,product.material,...(product.colorNames||[]),...(product.sizes||[])].filter(Boolean).join(' ').toLowerCase();
    const queryMatch = searchableText.includes(activeSearch);
    const categoryMatch = !activeCategory || product.category === activeCategory;
    return queryMatch && categoryMatch;
  });
  const ordered = [...matching].sort((a,b) => Number(b.isNew) - Number(a.isNew));
  const newProducts = ordered.slice(0,8);
  const shownIds = new Set(newProducts.map(product => product.id));
  const moreProducts = ordered.filter(product => !shownIds.has(product.id)).slice(0,8);
  const catalogUnavailable = window.FORME_CATALOG_SOURCE === 'unavailable';
  const empty = catalogUnavailable
    ? `<div class="search-empty" role="status"><strong>Collection unavailable.</strong>Please try again later.</div>`
    : `<div class="search-empty" role="status"><strong>No pieces found just yet.</strong>Try another search or explore all our new arrivals.</div>`;
  newGrid.innerHTML = newProducts.length ? newProducts.map(productCard).join('') : empty;
  bestGrid.innerHTML = moreProducts.map(productCard).join('');
  document.getElementById('best-sellers').hidden = moreProducts.length === 0;
  document.querySelectorAll('[data-home-category]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.homeCategory === activeCategory));
  });
  document.querySelector('#new-arrivals .eyebrow').textContent = activeSearch ? 'SEARCH RESULTS' : (activeCategory ? `${activeCategory.toUpperCase()} EDIT` : 'TRENDING NOW');
}
document.addEventListener('click', event => {
  const categoryChip = event.target.closest('[data-home-category]');
  if (categoryChip) {
    activeCategory = categoryChip.dataset.homeCategory;
    activeSearch = '';
    document.getElementById('product-search').value = '';
    syncSearchControls();
    renderProducts();
    return;
  }

  const categoryLink = event.target.closest('[data-category-link]');
  if (categoryLink) {
    activeCategory = categoryLink.dataset.categoryLink;
    activeSearch = '';
    document.getElementById('product-search').value = '';
    syncSearchControls();
    renderProducts();
  }
});

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('product-search');
const searchButton = searchForm.querySelector('.search-button');
const mobileSearch = window.matchMedia('(max-width: 680px)');
function syncSearchMode() {
  if (mobileSearch.matches) {
    searchInput.tabIndex = -1;
    searchInput.setAttribute('aria-hidden', 'true');
  } else {
    searchInput.removeAttribute('tabindex');
    searchInput.removeAttribute('aria-hidden');
  }
}
function syncSearchControls() {
  searchForm.querySelector('.search-clear').hidden = !searchInput.value;
  searchForm.classList.toggle('has-value', Boolean(searchInput.value));
}
syncSearchMode();
mobileSearch.addEventListener('change', syncSearchMode);
searchForm.addEventListener('submit', event => {
  event.preventDefault();
  activeSearch = searchInput.value.trim().toLowerCase();
  activeCategory = '';
  renderProducts();
  document.getElementById('new-arrivals').scrollIntoView({behavior:'smooth'});
});
searchInput.addEventListener('input', event => {
  activeSearch = event.target.value.trim().toLowerCase();
  activeCategory = '';
  syncSearchControls();
  renderProducts();
});
searchForm.querySelector('.search-clear').addEventListener('click', () => {
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', {bubbles:true}));
  searchInput.focus();
});
function searchPageHref() {
  const params = new URLSearchParams();
  params.set('return', window.location.pathname + window.location.search + window.location.hash);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  return `search.html?${params.toString()}`;
}
searchButton.addEventListener('click', event => {
  if (mobileSearch.matches) {
    event.preventDefault(); window.location.href = searchPageHref();
  }
});
document.querySelector('.home-search-trigger')?.addEventListener('click', () => {
  if (mobileSearch.matches) window.location.href = searchPageHref();
  else { searchInput.focus(); document.getElementById('new-arrivals').scrollIntoView({behavior:'smooth'}); }
});
document.getElementById('menu-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  document.getElementById('main-nav').classList.toggle('is-open', !isOpen);
});
document.querySelectorAll('#main-nav a').forEach(link => link.addEventListener('click', () => {
  document.getElementById('menu-toggle').setAttribute('aria-expanded','false');
  document.getElementById('main-nav').classList.remove('is-open');
}));

renderHomeCategoryChips();
renderProducts();
window.addEventListener('forme:wishlist', renderProducts);
window.FORME_CATALOG_READY?.then(loadedProducts => {
  products = Array.isArray(loadedProducts) ? loadedProducts : [];
  renderHomeCategoryChips();
  renderProducts();
  if (products.length) initHeroBestSellers(products);
});

// ---- Best Seller hero carousel ------------------------------------------------
// Only live Supabase products the admin explicitly marked as Best Seller can
// enter the hero. The legacy local catalog is never used to fill the carousel;
// when the filtered list is empty the static editorial hero stays in place.
function initHeroBestSellers(loadedProducts) {
  const heroCarousel = document.getElementById('hero-best-sellers');
  if (!heroCarousel) return;
  const bestSellers = (Array.isArray(loadedProducts) ? loadedProducts : [])
    .filter(product => product && product.source === 'supabase' && product.best === true);
  if (!bestSellers.length) return;
  const track = heroCarousel.querySelector('.hero-carousel-track');
  const dots = heroCarousel.querySelector('.hero-carousel-dots');
  const escapeHero = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  track.innerHTML = bestSellers.map((product, index) => {
    const name = escapeHero(product.name);
    const url = `product.html?id=${encodeURIComponent(product.id)}`;
    const oldPrice = product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : '';
    return `<div class="hero-carousel-slide${index===0?' is-active':''}" role="group" aria-label="${index+1} of ${bestSellers.length}: ${name}"${index===0?'':' aria-hidden="true"'}>
      <div class="hero-carousel-copy"><p class="hero-kicker"><span></span> BEST SELLERS</p><h2 class="hero-carousel-name"><a href="${url}">${name}</a></h2><p class="hero-carousel-price">${formatPrice(product.price)}${oldPrice}</p><div class="hero-carousel-buttons"><a class="button button-light" href="${url}">Shop now <span aria-hidden="true">→</span></a></div></div>
      <a class="hero-carousel-media" href="${url}" aria-label="View ${name}"><img src="${escapeHero(productImageUrl(product, 1200))}" alt="${name}"${index===0?' fetchpriority="high"':' loading="lazy"'}></a>
    </div>`;
  }).join('');
  dots.innerHTML = bestSellers.map((product, index) => `<button type="button" aria-label="Show ${escapeHero(product.name)}"${index===0?' aria-current="true"':''}></button>`).join('');
  track.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove(), {once: true}));
  const slides = [...track.querySelectorAll('.hero-carousel-slide')];
  const dotButtons = [...dots.querySelectorAll('button')];
  let activeIndex = 0;
  let rotationTimer = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function showSlide(nextIndex) {
    activeIndex = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const active = index === activeIndex;
      slide.classList.toggle('is-active', active);
      if (active) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', 'true');
    });
    dotButtons.forEach((dot, index) => {
      if (index === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }
  function stopRotation() {
    if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  }
  function startRotation() {
    stopRotation();
    if (prefersReducedMotion || slides.length < 2) return;
    rotationTimer = setInterval(() => showSlide(activeIndex + 1), 6500);
  }
  heroCarousel.querySelector('.hero-carousel-prev').addEventListener('click', () => { showSlide(activeIndex - 1); startRotation(); });
  heroCarousel.querySelector('.hero-carousel-next').addEventListener('click', () => { showSlide(activeIndex + 1); startRotation(); });
  dotButtons.forEach((dot, index) => dot.addEventListener('click', () => { showSlide(index); startRotation(); }));
  heroCarousel.addEventListener('mouseenter', stopRotation);
  heroCarousel.addEventListener('mouseleave', startRotation);
  heroCarousel.addEventListener('focusin', stopRotation);
  heroCarousel.addEventListener('focusout', event => { if (!heroCarousel.contains(event.relatedTarget)) startRotation(); });
  let swipeStartX = null;
  heroCarousel.addEventListener('pointerdown', event => { swipeStartX = typeof event.clientX === 'number' ? event.clientX : null; });
  heroCarousel.addEventListener('pointerup', event => {
    if (swipeStartX === null || typeof event.clientX !== 'number') return;
    const delta = event.clientX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(delta) < 40) return;
    showSlide(activeIndex + (delta < 0 ? 1 : -1));
    startRotation();
  });
  heroCarousel.addEventListener('pointercancel', () => { swipeStartX = null; });
  heroCarousel.hidden = false;
  document.querySelector('.hero')?.classList.add('has-bestsellers');
  startRotation();
}
