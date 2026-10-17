(() => {
  const authView = document.getElementById('auth-view');
  const loadingView = document.getElementById('loading-view');
  const dashboardView = document.getElementById('dashboard-view');
  const authMessage = document.getElementById('auth-message');
  const loginForm = document.getElementById('login-form');
  const loginButton = document.getElementById('login-button');
  const client = window.FORME_SUPABASE;
  let authCheckInProgress = false;
  let currentUser = null;
  let productCache = [];
  let categoryCache = [];
  let stockCache = [];
  let orderCache = [];
  let currentOrder = null;
  let currentOrderItems = [];
  let historyOrderIds = new Set();
  let ordersBadgeOrderCount = null;
  let historySyncFailed = false;
  let callVerificationCache = [];
  let expandedCallVerificationRequests = new Set();
  let categoryHasSlug = false;
  let editingProduct = null;
  let editingCategory = null;
  // Ordered media list for the product form: {kind:'image'|'video',path,file,previewUrl}.
  let mediaItems = [];
  let mediaColumnReady = null;
  const MEDIA_IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);
  const MEDIA_VIDEO_TYPES = new Set(['video/mp4','video/webm']);
  const MEDIA_EXTENSIONS = {'.jpg':'image','.jpeg':'image','.png':'image','.webp':'image','.mp4':'video','.webm':'video'};
  const MEDIA_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MEDIA_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
  const MEDIA_MAX_IMAGES = 8;
  const MEDIA_MAX_VIDEOS = 3;

  function showView(view) {
    authView.hidden = view !== 'auth';
    loadingView.hidden = view !== 'loading';
    dashboardView.hidden = view !== 'dashboard';
  }

  function message(text, success = false) {
    authMessage.textContent = text;
    authMessage.classList.toggle('is-success', success);
  }

  async function verifyAdmin(user) {
    if (!client || !user) return false;
    // Authorization is decided by the existing database function and its RLS context.
    const { data, error } = await client.rpc('is_admin');
    if (error) throw error;
    return data === true;
  }

  async function loadDashboard(user) {
    currentUser = user;
    document.getElementById('admin-email').textContent = user.email || 'Administrator';
    document.getElementById('date-stamp').textContent = new Intl.DateTimeFormat(undefined, {weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date()).toUpperCase();
    const errorBox = document.getElementById('dashboard-error');
    errorBox.textContent = '';
    showView('dashboard');
    try {
      const [totalResult, activeResult, categoryResult, variantsResult] = await Promise.all([
        client.from('products').select('id', {count:'exact',head:true}),
        client.from('products').select('id', {count:'exact',head:true}).eq('is_active', true),
        client.from('categories').select('id', {count:'exact',head:true}),
        client.from('product_variants').select('product_id,stock')
      ]);
      const failed = [totalResult,activeResult,categoryResult,variantsResult].find(result=>result.error);
      if (failed) throw failed.error;
      document.getElementById('total-products').textContent = totalResult.count ?? '—';
      document.getElementById('active-products').textContent = activeResult.count ?? '—';
      document.getElementById('category-count').textContent = categoryResult.count ?? '—';
      updateStockMetrics(variantsResult.data || []);
    } catch (error) {
      console.error('VC Fashion dashboard counts could not be loaded.', error);
      errorBox.textContent = 'We could not load store counts. Check the products, categories, and variants read policies, then refresh.';
    }
    try{await loadOrderSummary();}catch(error){console.error('VC Fashion order summary could not be loaded.',error);document.getElementById('total-orders').textContent='—';document.getElementById('pending-orders').textContent='—';}
    try{await loadCallVerificationBadge();}catch(error){console.error('VC Fashion call verification badge could not be loaded.',error);}
    startSidebarBadgeRefresh();
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(paise||0)/100);
  const productFeedback = (text, error=false) => {
    const el=document.getElementById('product-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);
  };
  // Sidebar count badges sit on the far right of their nav row: green for
  // pending Orders and Call Verification work, red for Stock needing attention.
  // Counts always come from live queries; a badge just hides when its count is zero.
  let sidebarBadgeTimer=null;
  function setNavBadge(name,count){
    const badge=document.querySelector(`[data-nav-badge="${name}"]`);
    if(!badge)return;
    const total=Math.max(0,Number(count)||0);
    badge.hidden=total===0;
    const countEl=badge.querySelector('[data-nav-badge-count]');
    if(countEl)countEl.textContent=String(total);
  }
  // The Orders badge counts every order not yet saved in Customer History,
  // whatever its order or payment status. It is derived from two snapshots
  // kept in sync with the database: the total order count and the set of
  // order ids already saved in Customer History. Both must be known before
  // the badge renders, so a failed history load never shows a wrong zero.
  function setOrdersBadge(){
    if(ordersBadgeOrderCount===null||historySyncFailed)return;
    setNavBadge('orders',ordersBadgeOrderCount-historyOrderIds.size);
  }
  function updateStockMetrics(variants){
    const lowStockProducts=new Set();
    const stockAttentionProducts=new Set();
    for(const row of variants){
      const id=String(row.product_id),stock=Number(row.stock);
      if(!Number.isFinite(stock))continue;
      if(stock>=1&&stock<=5)lowStockProducts.add(id);
      // Stock badge: critical stock only — a product with any variant at exactly
      // 0 or 1 units, deduplicated by product so it is never counted twice.
      if(stock<=1)stockAttentionProducts.add(id);
    }
    document.getElementById('low-stock-count').textContent=lowStockProducts.size;
    setNavBadge('stock',stockAttentionProducts.size);
  }

  function imagePath(product) { return product.image_path || product.main_image_path || ''; }
  async function imageUrlFor(path) {
    if (!path) return '';
    try {
      const {data,error}=await client.storage.from('product-images').createSignedUrl(path,3600);
      if (error) throw error;
      return data?.signedUrl || '';
    } catch(error) {
      console.warn('Could not create a signed product image URL.',error);
      return '';
    }
  }
  // The stored gallery manifest keeps the main image first so image_path and
  // media stay in sync; reading tolerates both string and parsed jsonb values.
  function readMediaEntries(product) {
    const raw = product?.media;
    let list = Array.isArray(raw) ? raw : null;
    if (!list && typeof raw === 'string' && raw.trim()) {
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) list = parsed; } catch {}
    }
    if (!list) {
      const single = imagePath(product);
      return single ? [{path:single,type:'image'}] : [];
    }
    return list
      .filter(entry => entry && typeof entry.path === 'string' && entry.path)
      .map(entry => ({path:entry.path,type:entry.type === 'video' ? 'video' : 'image'}));
  }
  function storedMediaPaths(product) {
    const paths = [imagePath(product), ...readMediaEntries(product).map(entry => entry.path)];
    return [...new Set(paths.filter(path => path && !/^https?:\/\//i.test(path)))];
  }
  async function removeStoredMediaPaths(paths) {
    const unique = [...new Set((paths||[]).filter(path => typeof path === 'string' && path && !/^https?:\/\//i.test(path)))];
    for (const path of unique) {
      const {data,error} = await client.from('products').select('id').eq('image_path',path).limit(1);
      if (error) { console.warn('Keeping a media file because its references could not be checked.', error); continue; }
      if (data?.length) continue;
      const {error:removeError} = await client.storage.from('product-images').remove([path]);
      if (removeError) console.warn('A product media file could not be removed.', removeError);
    }
  }
  async function mediaColumnAvailable() {
    if (mediaColumnReady !== null) return mediaColumnReady;
    if (!client) { mediaColumnReady = false; return false; }
    const {error} = await client.from('products').select('media').limit(1);
    mediaColumnReady = !error;
    return mediaColumnReady;
  }
  const isMediaColumnMissing = error => Boolean(error) && (error.code === 'PGRST204' || /Could not find the 'media' column/i.test(error.message || ''));
  function mediaKindFromFile(file) {
    const name = String(file?.name || '').toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (MEDIA_IMAGE_TYPES.has(file?.type)) return 'image';
    if (MEDIA_VIDEO_TYPES.has(file?.type)) return 'video';
    if (!file?.type && MEDIA_EXTENSIONS[ext]) return MEDIA_EXTENSIONS[ext];
    return null;
  }
  function mediaSizeLimitText(kind) { return kind === 'image' ? '5 MB image' : '25 MB video'; }
  function revokeMediaPreviews() {
    for (const item of mediaItems) if (item.file && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    mediaItems = [];
  }
  function renderMediaGrid() {
    const grid = document.getElementById('media-grid');
    const empty = document.getElementById('media-empty');
    if (!grid || !empty) return;
    empty.hidden = mediaItems.length > 0;
    grid.innerHTML = mediaItems.map((item, index) => {
      const isLast = index === mediaItems.length - 1;
      const thumb = item.previewUrl
        ? (item.kind === 'video'
            ? `<video src="${escapeHtml(item.previewUrl)}" muted playsinline preload="metadata" tabindex="-1"></video><span class="media-kind-badge">VIDEO</span>`
            : `<img src="${escapeHtml(item.previewUrl)}" alt="" loading="lazy">`)
        : '<span class="media-thumb-empty">◇</span>';
      const mainBadge = index === 0 && item.kind === 'image' ? '<span class="media-main-badge">MAIN</span>' : '';
      const makeMain = item.kind === 'image' && index !== 0
        ? `<button type="button" class="media-make-main" data-media-main="${index}" aria-label="Set as main image">★</button>`
        : '';
      return `<div class="media-item"><div class="media-item-thumb">${thumb}${mainBadge}</div><div class="media-item-actions"><button type="button" data-media-move="-1" data-media-index="${index}" aria-label="Move media earlier"${index === 0 ? ' disabled' : ''}>←</button><button type="button" data-media-move="1" data-media-index="${index}" aria-label="Move media later"${isLast ? ' disabled' : ''}>→</button>${makeMain}<button type="button" class="media-remove" data-media-remove="${index}" aria-label="Remove media">×</button></div></div>`;
    }).join('');
  }
  function moveMediaItem(index, delta) {
    const target = index + delta;
    if (!Number.isInteger(index) || !Number.isInteger(delta)) return;
    if (index < 0 || index >= mediaItems.length || target < 0 || target >= mediaItems.length) return;
    const [item] = mediaItems.splice(index, 1);
    mediaItems.splice(target, 0, item);
    renderMediaGrid();
  }
  function makeMainMediaItem(index) {
    if (!Number.isInteger(index) || index < 0 || index >= mediaItems.length) return;
    const item = mediaItems[index];
    if (!item || item.kind !== 'image') return;
    mediaItems.splice(index, 1);
    mediaItems.unshift(item);
    renderMediaGrid();
  }
  function removeMediaItem(index) {
    if (!Number.isInteger(index) || index < 0 || index >= mediaItems.length) return;
    const [item] = mediaItems.splice(index, 1);
    if (item && item.file && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    renderMediaGrid();
  }
  function addMediaFiles(files) {
    const rejected = [];
    let images = mediaItems.filter(item => item.kind === 'image').length;
    let videos = mediaItems.filter(item => item.kind === 'video').length;
    for (const file of files) {
      const label = file.name || 'file';
      const kind = mediaKindFromFile(file);
      if (!kind) { rejected.push(`${label}: unsupported format (use JPG, JPEG, PNG, WEBP, MP4 or WEBM)`); continue; }
      if (!file.size) { rejected.push(`${label}: empty file`); continue; }
      const limit = kind === 'image' ? MEDIA_MAX_IMAGE_BYTES : MEDIA_MAX_VIDEO_BYTES;
      if (file.size > limit) { rejected.push(`${label}: over the ${mediaSizeLimitText(kind)} limit`); continue; }
      if (kind === 'image' && images >= MEDIA_MAX_IMAGES) { rejected.push(`${label}: image limit of ${MEDIA_MAX_IMAGES} reached`); continue; }
      if (kind === 'video' && videos >= MEDIA_MAX_VIDEOS) { rejected.push(`${label}: video limit of ${MEDIA_MAX_VIDEOS} reached`); continue; }
      if (mediaItems.some(item => item.file && item.file.name === file.name && item.file.size === file.size)) { rejected.push(`${label}: already selected`); continue; }
      mediaItems.push({kind,path:'',file,previewUrl:URL.createObjectURL(file)});
      if (kind === 'image') images++; else videos++;
    }
    renderMediaGrid();
    const feedback = document.getElementById('form-feedback');
    if (rejected.length) {
      feedback.textContent = `Some files were skipped — ${rejected.join('; ')}.`;
      feedback.classList.add('is-error');
    } else if (feedback.textContent.startsWith('Some files were skipped')) {
      feedback.textContent = '';
      feedback.classList.remove('is-error');
    }
  }
  async function loadSavedMedia(product) {
    revokeMediaPreviews();
    if (!product) { renderMediaGrid(); return; }
    mediaItems = readMediaEntries(product).map(entry => ({kind:entry.type,path:entry.path,file:null,previewUrl:''}));
    renderMediaGrid();
    await Promise.all(mediaItems.map(async item => { item.previewUrl = await imageUrlFor(item.path) || ''; }));
    if (editingProduct === product) renderMediaGrid();
  }
  function categoryName(id) { return categoryCache.find(category=>String(category.id)===String(id))?.name || 'Uncategorized'; }
  function stockSummary(productId) {
    const total=productCache.find(product=>String(product.id)===String(productId))?.totalStock || 0;
    if(total===0)return '<span class="stock-pill stock-out">Out of stock</span>';
    if(total<=5)return `<span class="stock-pill stock-low">Low stock · ${total}</span>`;
    return `<span class="stock-pill">${total} available</span>`;
  }
  function setProductOptions() {
    const filter=document.getElementById('category-filter'),select=document.getElementById('product-category');
    const filterValue=filter.value, selected=select.value;
    filter.innerHTML='<option value="">All categories</option>'+categoryCache.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    select.innerHTML='<option value="">Choose category</option>'+categoryCache.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    filter.value=filterValue;select.value=selected;
  }
  function categoryFeedback(text,error=false){const el=document.getElementById('category-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);}
  async function loadManagedCategories(){
    const rows=document.getElementById('category-rows');
    rows.innerHTML='<tr><td colspan="3" class="table-message">Loading categories…</td></tr>';
    document.getElementById('category-mobile-list').innerHTML='<div class="table-message">Loading categories…</div>';
    categoryFeedback('');
    try{
      const [categoryResult,productResult]=await Promise.all([
        client.from('categories').select('*').order('name',{ascending:true}),
        client.from('products').select('category_id')
      ]);
      if(categoryResult.error)throw categoryResult.error;
      if(productResult.error)throw productResult.error;
      categoryHasSlug=(categoryResult.data||[]).some(row=>Object.prototype.hasOwnProperty.call(row,'slug'));
      categoryCache=(categoryResult.data||[]).map(row=>({id:row.id,name:String(row.name??row.title??row.slug??'Uncategorized')}));
      const counts=new Map();for(const product of productResult.data||[]){const key=String(product.category_id??'');if(key)counts.set(key,(counts.get(key)||0)+1);}
      const html=categoryCache.map(category=>`<tr><td><div class="category-name-cell"><span class="category-symbol">▦</span><strong>${escapeHtml(category.name)}</strong></div></td><td><span class="category-product-count">${counts.get(String(category.id))||0} <small>${(counts.get(String(category.id))||0)===1?'product':'products'}</small></span></td><td><div class="row-actions"><button type="button" data-edit-category="${escapeHtml(category.id)}">Edit</button><button type="button" class="delete-action" data-delete-category="${escapeHtml(category.id)}">Delete</button></div></td></tr>`).join('');
      rows.innerHTML=html||'<tr><td colspan="3" class="table-message">No categories yet. Add your first collection to get started.</td></tr>';
      const cards=categoryCache.map(category=>`<article class="category-mobile-card"><div><span class="category-symbol">▦</span><strong>${escapeHtml(category.name)}</strong><small>${counts.get(String(category.id))||0} ${(counts.get(String(category.id))||0)===1?'product':'products'}</small></div><div class="row-actions"><button type="button" data-edit-category="${escapeHtml(category.id)}">Edit</button><button type="button" class="delete-action" data-delete-category="${escapeHtml(category.id)}">Delete</button></div></article>`).join('');
      document.getElementById('category-mobile-list').innerHTML=cards||'<div class="table-message">No categories yet. Add your first collection to get started.</div>';
      setProductOptions();
      document.getElementById('category-count').textContent=categoryCache.length;
    }catch(error){
      console.error('VC Fashion categories could not be loaded.',error);
      rows.innerHTML='<tr><td colspan="3" class="table-message">Could not load categories. Check the categories and products read policies.</td></tr>';
      document.getElementById('category-mobile-list').innerHTML='';
      categoryFeedback('Category loading failed: '+(error.message||'check Supabase access.'),true);
    }
  }
  const stockStatus = stock => Number(stock)===0
    ? {label:'Out of stock',className:'stock-out'}
    : Number(stock)<=5 ? {label:'Low stock',className:'stock-low'}
    : {label:'In stock',className:'stock-available'};
  function stockFeedback(text,error=false){const el=document.getElementById('stock-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);}
  function setStockCategoryOptions(){
    const select=document.getElementById('stock-category-filter'),current=select.value;
    select.innerHTML='<option value="">All categories</option>'+categoryCache.map(category=>`<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');select.value=current;
  }
  async function loadStockManagement(){
    const rows=document.getElementById('stock-rows');rows.innerHTML='<tr><td colspan="8" class="table-message">Loading stock…</td></tr>';
    document.getElementById('stock-mobile-list').innerHTML='<div class="table-message">Loading stock…</div>';stockFeedback('');
    try{
      const [productsResult,variantsResult,categoriesResult]=await Promise.all([
        client.from('products').select('id,name,image_path,category_id'),
        client.from('product_variants').select('*'),
        client.from('categories').select('*').order('name',{ascending:true})
      ]);
      for(const result of [productsResult,variantsResult,categoriesResult])if(result.error)throw result.error;
      const productsById=new Map((productsResult.data||[]).map(product=>[String(product.id),product]));
      categoryCache=(categoriesResult.data||[]).map(row=>({id:row.id,name:String(row.name??row.title??row.slug??'Uncategorized')}));
      stockCache=(variantsResult.data||[]).map(variant=>({...variant,product:productsById.get(String(variant.product_id))||null}));
      setStockCategoryOptions();updateStockMetrics(variantsResult.data||[]);await renderStockRows();
    }catch(error){
      console.error('VC Fashion stock could not be loaded.',error);rows.innerHTML='<tr><td colspan="8" class="table-message">Could not load stock. Check the products and product variants read policies.</td></tr>';document.getElementById('stock-mobile-list').innerHTML='';stockFeedback('Stock loading failed: '+(error.message||'check Supabase access.'),true);
    }
  }
  async function renderStockRows(){
    const query=document.getElementById('stock-search').value.trim().toLowerCase(),category=document.getElementById('stock-category-filter').value,status=document.getElementById('stock-status-filter').value;
    const signedImages=new Map(),signedImage=path=>{if(!signedImages.has(path))signedImages.set(path,imageUrlFor(path));return signedImages.get(path);};
    const variants=stockCache.filter(variant=>{
      const product=variant.product||{},stock=Number(variant.stock)||0,state=stockStatus(stock).className;
      const text=`${product.name||''} ${variant.sku||''}`.toLowerCase();
      return (!query||text.includes(query))&&(!category||String(product.category_id)===category)&&(!status||state===({out:'stock-out',low:'stock-low',available:'stock-available'}[status]));
    });
    const rows=await Promise.all(variants.map(async variant=>{
      const product=variant.product||{},image=await signedImage(product.image_path||'');
      const imageMarkup=image?`<img src="${escapeHtml(image)}" alt="" loading="lazy">`:'<span class="product-thumb-empty">◇</span>';
      const state=stockStatus(variant.stock),id=escapeHtml(variant.id),stock=Number(variant.stock)||0;
      return `<tr data-stock-row="${id}"><td><div class="product-cell stock-product-cell">${imageMarkup}<span>${escapeHtml(product.name||'Unknown product')}</span></div></td><td>${escapeHtml(variant.sku||'—')}</td><td>${escapeHtml(variant.size||'—')}</td><td><span class="stock-color"><i style="background:${/^#[0-9a-fA-F]{6}$/.test(variant.color_hex||'')?variant.color_hex:'#d8d5ce'}"></i>${escapeHtml(variant.color_name||'—')}</span></td><td>${escapeHtml(categoryName(product.category_id))}</td><td class="stock-value-cell"><span data-stock-value>${stock}</span><input class="stock-edit-input" type="number" min="0" step="1" required value="${stock}" aria-label="New stock for ${escapeHtml(product.name||'variant')}" hidden></td><td><span class="stock-pill ${state.className}" data-stock-status>${state.label}</span></td><td><button class="stock-edit-button" type="button" data-stock-edit="${id}">Update</button><span class="stock-save-actions" hidden><button type="button" data-stock-save="${id}">Save</button><button type="button" data-stock-cancel="${id}">Cancel</button></span></td></tr>`;
    }));
    document.getElementById('stock-rows').innerHTML=rows.length?rows.join(''):'<tr><td colspan="8" class="table-message">No variants match these filters.</td></tr>';
    const cards=variants.map(variant=>{
      const product=variant.product||{},state=stockStatus(variant.stock),stock=Number(variant.stock)||0;
      const image=signedImage(product.image_path||'');
      return {variant,product,state,stock,image};
    });
    const cardMarkup=await Promise.all(cards.map(async ({variant,product,state,stock,image})=>{
      const imageUrl=await image;
      const imageMarkup=imageUrl?`<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">`:'<span class="product-thumb-empty">◇</span>',id=escapeHtml(variant.id);
      return `<article class="stock-mobile-card" data-stock-row="${id}"><div class="stock-mobile-product">${imageMarkup}<div><strong>${escapeHtml(product.name||'Unknown product')}</strong><small>${escapeHtml(variant.sku||'No SKU')} · ${escapeHtml(variant.size||'—')} · ${escapeHtml(variant.color_name||'—')}</small><small>${escapeHtml(categoryName(product.category_id))}</small></div></div><div class="stock-mobile-control"><span class="stock-pill ${state.className}" data-stock-status>${state.label}</span><span class="stock-value-mobile" data-stock-value>${stock}</span><input class="stock-edit-input" type="number" min="0" step="1" required value="${stock}" aria-label="New stock" hidden><button class="stock-edit-button" type="button" data-stock-edit="${id}">Update</button><span class="stock-save-actions" hidden><button type="button" data-stock-save="${id}">Save</button><button type="button" data-stock-cancel="${id}">Cancel</button></span></div></article>`;
    }));
    document.getElementById('stock-mobile-list').innerHTML=cardMarkup.length?cardMarkup.join(''):'<div class="table-message">No variants match these filters.</div>';
    document.querySelectorAll('.stock-table img,.stock-mobile-product img').forEach(img=>img.addEventListener('error',()=>{const placeholder=document.createElement('span');placeholder.className='product-thumb-empty';placeholder.textContent='◇';img.replaceWith(placeholder);},{once:true}));
  }
  function setStockEditMode(row,editing){
    row.querySelectorAll('[data-stock-value]').forEach(node=>node.hidden=editing);
    row.querySelectorAll('.stock-edit-input').forEach(input=>{input.hidden=!editing;if(editing){input.value=row.querySelector('[data-stock-value]').textContent;input.focus();input.select();}});
    row.querySelector('.stock-edit-button').hidden=editing;row.querySelector('.stock-save-actions').hidden=!editing;
  }
  async function saveVariantStock(row,variantId){
    const input=row.querySelector('.stock-edit-input'),raw=input.value.trim(),feedback=document.getElementById('stock-feedback');
    if(raw===''||!Number.isInteger(Number(raw))||Number(raw)<0){stockFeedback('Stock must be a whole number zero or greater.',true);input.focus();return;}
    const value=Number(raw),save=row.querySelector('[data-stock-save]');save.disabled=true;stockFeedback('Saving stock…');
    try{
      const {data,error}=await client.from('product_variants').update({stock:value}).eq('id',variantId).select('id,stock').single();if(error)throw error;if(!data)throw new Error('No stock row was updated.');
      const variant=stockCache.find(item=>String(item.id)===String(variantId));if(variant)variant.stock=data.stock;
      updateStockMetrics(stockCache);await renderStockRows();stockFeedback('Stock updated successfully.');
    }catch(error){console.error('VC Fashion stock update failed.',error);stockFeedback('Could not update stock: '+(error.message||'check the RLS policy.'),true);save.disabled=false;}
  }
  function openCategoryModal(category=null){
    editingCategory=category;const form=document.getElementById('category-form');form.reset();
    document.getElementById('category-modal-title').textContent=category?'Edit category':'Add category';
    document.getElementById('save-category').textContent=category?'Save changes':'Save category';
    document.getElementById('category-form-feedback').textContent='';
    form.elements.name.value=category?.name||'';
    document.getElementById('category-modal').hidden=false;document.body.classList.add('modal-open');form.elements.name.focus();
  }
  function closeCategoryModal(force=false){const form=document.getElementById('category-form');if(form.dataset.saving==='true'&&!force)return;document.getElementById('category-modal').hidden=true;document.body.classList.remove('modal-open');editingCategory=null;}
  async function handleCategorySave(event){
    event.preventDefault();const form=document.getElementById('category-form'),button=document.getElementById('save-category'),feedback=document.getElementById('category-form-feedback');
    const name=form.elements.name.value.trim();feedback.textContent='';feedback.classList.remove('is-error');
    if(!name){feedback.textContent='Enter a category name.';feedback.classList.add('is-error');form.elements.name.focus();return;}
    button.disabled=true;form.dataset.saving='true';feedback.textContent='Saving category…';
    try{
      const {data:categories,error:checkError}=await client.from('categories').select('*');if(checkError)throw checkError;
      const duplicate=(categories||[]).some(row=>String(row.id)!==String(editingCategory?.id??'')&&String(row.name??'').trim().toLocaleLowerCase()===name.toLocaleLowerCase());
      if(duplicate)throw new Error('A category with this name already exists.');
      if(editingCategory){const {error}=await client.from('categories').update({name}).eq('id',editingCategory.id);if(error)throw error;}
      else{const payload={name};if(categoryHasSlug){let slug=name.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||`category-${crypto.randomUUID().slice(0,8)}`;if((categories||[]).some(row=>row.slug===slug))slug+=`-${crypto.randomUUID().slice(0,8)}`;payload.slug=slug;}const {error}=await client.from('categories').insert(payload);if(error)throw error;}
      const wasEditing=Boolean(editingCategory);closeCategoryModal(true);await loadManagedCategories();categoryFeedback(wasEditing?'Category updated successfully.':'Category added successfully.');
    }catch(error){console.error('VC Fashion category save failed.',error);feedback.textContent=error.message||'Could not save this category.';feedback.classList.add('is-error');}
    finally{button.disabled=false;delete form.dataset.saving;}
  }
  async function deleteCategory(categoryId){
    const category=categoryCache.find(row=>String(row.id)===String(categoryId));if(!category)return;
    categoryFeedback('Checking product usage…');
    try{
      const {count,error:usageError}=await client.from('products').select('id',{count:'exact',head:true}).eq('category_id',category.id);
      if(usageError)throw usageError;
      if(count===null)throw new Error('Could not verify whether products use this category.');
      if(count>0){categoryFeedback('Cannot delete this category because products are using it.',true);return;}
      if(!window.confirm(`Delete the “${category.name}” category?`)){categoryFeedback('');return;}
      categoryFeedback('Deleting category…');
      const {error}=await client.from('categories').delete().eq('id',category.id);if(error)throw error;
      await loadManagedCategories();categoryFeedback('Category deleted successfully.');
    }catch(error){console.error('VC Fashion category delete failed.',error);categoryFeedback('Could not delete category: '+(error.message||'check the database policy.'),true);}
  }
  async function loadManagedProducts() {
    const tbody=document.getElementById('product-rows');
    tbody.innerHTML='<tr><td colspan="6" class="table-message">Loading products…</td></tr>';
    document.getElementById('product-mobile-list').innerHTML='<div class="table-message">Loading products…</div>';
    productFeedback('');
    try {
      const [productsResult,categoriesResult,variantsResult]=await Promise.all([
        client.from('products').select('*').order('sort_order',{ascending:true}),
        client.from('categories').select('*').order('name',{ascending:true}),
        client.from('product_variants').select('*')
      ]);
      for(const result of [productsResult,categoriesResult,variantsResult])if(result.error)throw result.error;
      categoryCache=(categoriesResult.data||[]).map(row=>({id:row.id,name:String(row.name??row.title??row.slug??'Uncategorized')}));
      const variantsByProduct=new Map();
      for(const variant of variantsResult.data||[]){const key=String(variant.product_id);if(!variantsByProduct.has(key))variantsByProduct.set(key,[]);variantsByProduct.get(key).push(variant);}
      productCache=(productsResult.data||[]).map(row=>{
        const variants=variantsByProduct.get(String(row.id))||[];
        return {...row,variants,totalStock:variants.reduce((sum,item)=>sum+Math.max(0,Number(item.stock)||0),0),active:Boolean(row.is_active??row.active??true)};
      });
      setProductOptions();
      await renderManagedProducts();
      document.getElementById('total-products').textContent=productCache.length;
      document.getElementById('active-products').textContent=productCache.filter(p=>p.active).length;
      document.getElementById('category-count').textContent=categoryCache.length;
      updateStockMetrics(variantsResult.data||[]);
    } catch(error) {
      console.error('VC Fashion products could not be loaded.',error);
      tbody.innerHTML='<tr><td colspan="6" class="table-message">Could not load products. Check the products, categories, and variants RLS policies.</td></tr>';
      document.getElementById('product-mobile-list').innerHTML='';
      productFeedback('Product loading failed: '+(error.message||'check Supabase access.'),true);
    }
  }
  async function renderManagedProducts() {
    const query=document.getElementById('product-search').value.trim().toLowerCase();
    const category=document.getElementById('category-filter').value;
    const status=document.getElementById('status-filter').value;
    const products=productCache.filter(product=>{
      const matchesText=!query||String(product.name||'').toLowerCase().includes(query)||String(product.slug||'').toLowerCase().includes(query);
      const matchesCategory=!category||String(product.category_id)===category;
      const matchesStatus=!status||(status==='active'?product.active:!product.active);
      return matchesText&&matchesCategory&&matchesStatus;
    });
    const rows=await Promise.all(products.map(async product=>{
      const img=await imageUrlFor(imagePath(product));
      const statusHtml=product.active?'<span class="status-pill is-active">Active</span>':'<span class="status-pill is-inactive">Inactive</span>';
      return `<tr><td><div class="product-cell">${img?`<img src="${escapeHtml(img)}" alt="" loading="lazy">`:'<span class="product-thumb-empty">◇</span>'}<span>${escapeHtml(product.name)}</span></div></td><td>${escapeHtml(categoryName(product.category_id))}</td><td><strong>${money(product.price_paise)}</strong>${product.compare_at_price_paise?`<del>${money(product.compare_at_price_paise)}</del>`:''}</td><td>${statusHtml}</td><td>${stockSummary(product.id)}</td><td><div class="row-actions"><button type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button><button type="button" class="delete-action" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></td></tr>`;
    }));
    const body=document.getElementById('product-rows');
    body.innerHTML=rows.length?rows.join(''):'<tr><td colspan="6" class="table-message">No products match these filters.</td></tr>';
    const cards=await Promise.all(products.map(async product=>{
      const img=await imageUrlFor(imagePath(product));
      return `<article class="mobile-product-card"><div class="mobile-product-top">${img?`<img src="${escapeHtml(img)}" alt="" loading="lazy">`:'<span class="product-thumb-empty">◇</span>'}<div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(categoryName(product.category_id))}</small><span>${money(product.price_paise)}${product.compare_at_price_paise?` <del>${money(product.compare_at_price_paise)}</del>`:''}</span></div>${product.active?'<span class="status-pill is-active">Active</span>':'<span class="status-pill is-inactive">Inactive</span>'}</div><div class="mobile-product-bottom">${stockSummary(product.id)}<div class="row-actions"><button type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button><button type="button" class="delete-action" data-delete-product="${escapeHtml(product.id)}">Delete</button></div></div></article>`;
    }));
    document.getElementById('product-mobile-list').innerHTML=cards.length?cards.join(''):'<div class="table-message">No products match these filters.</div>';
    document.querySelectorAll('.product-cell img,.mobile-product-top img').forEach(img=>img.addEventListener('error',()=>{
      const placeholder=document.createElement('span');placeholder.className='product-thumb-empty';placeholder.textContent='◇';img.replaceWith(placeholder);
    },{once:true}));
  }
  function addVariantRow(variant={}) {
    const row=document.createElement('div');row.className='variant-editor-row';if(variant.id!==undefined&&variant.id!==null)row.dataset.variantId=variant.id;
    const fields=[['size','Size',variant.size||''],['color_name','Color name',variant.color_name||''],['color_hex','Color hex',variant.color_hex||'#d8d5ce'],['stock','Stock',variant.stock??0],['sku','SKU',variant.sku||'']];
    for(const [name,label,value]of fields){const input=document.createElement('input');input.name=name;input.setAttribute('aria-label',label);input.placeholder=label;input.value=value;input.required=name==='size'||name==='color_name';if(name==='stock'){input.type='number';input.min='0';input.step='1';input.required=true;}if(name==='color_hex'){input.type='text';input.maxLength=7;}row.append(input);}
    const remove=document.createElement('button');remove.type='button';remove.className='remove-variant';remove.textContent='×';remove.setAttribute('aria-label','Remove variant');remove.addEventListener('click',()=>row.remove());row.append(remove);
    document.getElementById('variant-editor').append(row);
  }
  function openProductModal(product=null) {
    editingProduct=product;
    const modal=document.getElementById('product-modal'),form=document.getElementById('product-form');form.reset();
    delete form.elements.slug.dataset.edited;
    document.getElementById('product-modal-title').textContent=product?'Edit product':'Add product';
    document.getElementById('save-product').textContent=product?'Save changes':'Save product';
    document.getElementById('variant-editor').innerHTML='';
    document.getElementById('form-feedback').textContent='';
    setProductOptions();
    const fields=form.elements;
    if(product){fields.name.value=product.name||'';fields.slug.value=product.slug||'';fields.description.value=product.description||'';fields.category_id.value=product.category_id??'';fields.sort_order.value=product.sort_order??0;fields.price.value=(Number(product.price_paise||0)/100).toFixed(2);fields.compare_at_price.value=product.compare_at_price_paise? (Number(product.compare_at_price_paise)/100).toFixed(2):'';fields.is_active.checked=product.active;fields.is_new.checked=Boolean(product.is_new);fields.is_best_seller.checked=Boolean(product.is_best_seller??product.best_seller);for(const v of product.variants)addVariantRow(v);}
    loadSavedMedia(product);
    mediaColumnAvailable();
    modal.hidden=false;document.body.classList.add('modal-open');document.getElementById('product-form').elements.name.focus();
  }
  function closeProductModal(force=false) {const form=document.getElementById('product-form');if(form.dataset.saving==='true'&&!force)return;document.getElementById('product-modal').hidden=true;document.body.classList.remove('modal-open');revokeMediaPreviews();editingProduct=null;}
  function getVariantsFromForm(productId) {
    return [...document.querySelectorAll('.variant-editor-row')].map(row=>({id:row.dataset.variantId||null,product_id:productId,size:row.querySelector('[name="size"]').value.trim(),color_name:row.querySelector('[name="color_name"]').value.trim(),color_hex:row.querySelector('[name="color_hex"]').value.trim(),stock:Number(row.querySelector('[name="stock"]').value),sku:row.querySelector('[name="sku"]').value.trim()||null}));
  }
  function priceInPaise(value,required=false) {
    if(value===''&&!required)return null;
    const number=Number(value);if(!Number.isFinite(number)||number<0||(required&&number<=0))throw new Error('Enter a valid INR price.');
    const paise=Math.round(number*100);if(!Number.isSafeInteger(paise))throw new Error('Price is too large.');return paise;
  }
  async function uploadProductMediaFile(file, productId) {
    if(!(file instanceof File))throw new Error('Choose a file before uploading.');
    const kind=mediaKindFromFile(file);
    if(!kind)throw new Error(`“${file.name||'file'}” is not a supported product media file (JPG, JPEG, PNG, WEBP, MP4 or WEBM).`);
    if(!file.size)throw new Error(`“${file.name||'file'}” is empty and cannot be uploaded.`);
    const limit=kind==='image'?MEDIA_MAX_IMAGE_BYTES:MEDIA_MAX_VIDEO_BYTES;
    if(file.size>limit)throw new Error(`“${file.name||'file'}” exceeds the ${mediaSizeLimitText(kind)} limit.`);
    if(!productId)throw new Error('Save the product record before uploading its media.');
    const safeName=file.name.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||`product-${kind}`;
    const path=`products/${productId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const {error}=await client.storage.from('product-images').upload(path,file,{contentType:file.type||undefined,upsert:false});
    if(error)throw new Error(`“${file.name||'file'}” could not be uploaded: ${error.message||'storage upload failed'}`);
    return path;
  }
  async function saveVariants(productId, variants, existingVariants=[]) {
    for(const v of variants){if(!v.size||!v.color_name||!Number.isInteger(v.stock)||v.stock<0)throw new Error('Complete each variant with a size, color name and whole-number stock.');if(!/^#[0-9a-fA-F]{6}$/.test(v.color_hex))throw new Error('Use a six-digit hex value for each variant color.');}
    const keepIds=variants.filter(v=>v.id).map(v=>v.id);
    const removed=existingVariants.map(v=>v.id).filter(id=>!keepIds.some(keep=>String(keep)===String(id)));
    if(removed.length){const {error}=await client.from('product_variants').delete().eq('product_id',productId).in('id',removed);if(error)throw error;}
    for(const v of variants.filter(item=>item.id)){
      const {error}=await client.from('product_variants').update({size:v.size,color_name:v.color_name,color_hex:v.color_hex,stock:v.stock,sku:v.sku}).eq('id',v.id).eq('product_id',productId);
      if(error)throw error;
    }
    const additions=variants.filter(v=>!v.id).map(({id,...v})=>({...v,product_id:productId}));
    if(additions.length){const {error}=await client.from('product_variants').insert(additions);if(error)throw error;}
  }
  async function handleProductSave(event) {
    event.preventDefault();const button=document.getElementById('save-product'),form=document.getElementById('product-form'),feedback=document.getElementById('form-feedback');
    button.disabled=true;form.dataset.saving='true';feedback.textContent='Saving product…';feedback.classList.remove('is-error');
    let createdId=null,uploadedMediaPaths=[],mediaNotice='';
    try {
      const f=form.elements,name=f.name.value.trim(),slug=f.slug.value.trim();if(!name||!slug||!f.category_id.value)throw new Error('Name, slug and category are required.');
      const productData={name,slug,description:f.description.value.trim(),category_id:f.category_id.value,price_paise:priceInPaise(f.price.value,true),compare_at_price_paise:priceInPaise(f.compare_at_price.value),is_active:f.is_active.checked,is_new:f.is_new.checked,is_best_seller:f.is_best_seller.checked,sort_order:Number(f.sort_order.value)||0};
      const variants=getVariantsFromForm(editingProduct?.id||'pending');
      for(const v of variants){if(!v.size||!v.color_name||!Number.isInteger(v.stock)||v.stock<0)throw new Error('Complete each variant with a size, color name and whole-number stock.');if(!/^#[0-9a-fA-F]{6}$/.test(v.color_hex))throw new Error('Use a six-digit hex value for each variant color.');}
      if(!mediaItems.some(item=>item.kind==='image'))throw new Error('Add at least one product image before saving.');
      const previouslyStored=editingProduct?storedMediaPaths(editingProduct):[];
      const uploadMediaEntries=async productId=>{
        const entries=[];
        for(const item of mediaItems){
          if(!item.path){item.path=await uploadProductMediaFile(item.file,productId);item.file=null;uploadedMediaPaths.push(item.path);}
          entries.push({path:item.path,type:item.kind});
        }
        return entries;
      };
      // The main image stays in image_path for full backward compatibility; the
      // ordered manifest goes to the media column when the migration is applied.
      const writeMediaFields=async(productId,entries)=>{
        const mainImage=entries.find(entry=>entry.type==='image');
        if(!mainImage)throw new Error('Add at least one product image before saving.');
        const fields={image_path:mainImage.path};
        if(await mediaColumnAvailable()){
          let {error}=await client.from('products').update({...fields,media:entries}).eq('id',productId);
          if(error&&isMediaColumnMissing(error)){
            ({error}=await client.from('products').update(fields).eq('id',productId));
            if(!error)mediaNotice='Product saved. Apply supabase/proposals/product-media-gallery.sql to also store extra images and videos.';
          }
          if(error)throw error;
        }else{
          const {error}=await client.from('products').update(fields).eq('id',productId);
          if(error)throw error;
          mediaNotice='Product saved. Apply supabase/proposals/product-media-gallery.sql to also store extra images and videos.';
        }
      };
      if(editingProduct){
        const entries=await uploadMediaEntries(editingProduct.id);
        const {error}=await client.from('products').update(productData).eq('id',editingProduct.id);if(error)throw error;
        await writeMediaFields(editingProduct.id,entries);
        await saveVariants(editingProduct.id,variants,editingProduct.variants);
        const kept=new Set(entries.map(entry=>entry.path));
        await removeStoredMediaPaths(previouslyStored.filter(path=>!kept.has(path)));
      }else{
        const {data,error}=await client.from('products').insert(productData).select('id').single();if(error)throw error;createdId=data.id;
        const entries=await uploadMediaEntries(createdId);
        await writeMediaFields(createdId,entries);
        await saveVariants(createdId,variants,[]);
      }
      const wasEditing=Boolean(editingProduct);closeProductModal(true);await loadManagedProducts();productFeedback(mediaNotice||(wasEditing?'Product updated successfully.':'Product added successfully.'));
    } catch(error){
      console.error('VC Fashion product save failed.',error);
      if(createdId){await client.from('product_variants').delete().eq('product_id',createdId);const {error:rollbackError}=await client.from('products').delete().eq('id',createdId);if(!rollbackError)await removeStoredMediaPaths(uploadedMediaPaths);}
      feedback.textContent=error.message||'Could not save product. Check your connection and RLS policies.';feedback.classList.add('is-error');
    } finally {button.disabled=false;delete form.dataset.saving;}
  }
  async function deleteProduct(productId) {
    const product=productCache.find(item=>String(item.id)===String(productId));if(!product)return;
    if(!window.confirm(`Delete “${product.name}”? This will permanently delete the product and all its variants.`))return;
    productFeedback('Deleting product…');
    try{
      const {error:variantError}=await client.from('product_variants').delete().eq('product_id',product.id);if(variantError)throw variantError;
      const {error}=await client.from('products').delete().eq('id',product.id);if(error)throw error;
      await removeStoredMediaPaths(storedMediaPaths(product));
      let successMessage='Product deleted successfully.';
      await loadManagedProducts();productFeedback(successMessage,successMessage!=='Product deleted successfully.');
    }catch(error){console.error('VC Fashion product delete failed.',error);productFeedback('Could not delete product: '+(error.message||'check foreign keys and RLS policies.'),true);await loadManagedProducts();}
  }

  const orderStatuses=['pending','confirmed','processing','shipped','delivered','cancelled'];
  // A browser-side admin control must never be able to assert that money was
  // received. Only the verified Razorpay server flow may move an order to paid.
  const paymentStatuses=['pending','failed'];
  function formatOrderDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(date);}
  function updateOrderSummary(orders){const pending=orders.filter(order=>String(order.order_status).toLowerCase()==='pending').length;document.getElementById('total-orders').textContent=orders.length;document.getElementById('pending-orders').textContent=pending;ordersBadgeOrderCount=orders.length;setOrdersBadge();}
  async function loadOrderSummary(){
    const [total,pending]=await Promise.all([
      client.from('orders').select('id',{count:'exact',head:true}),
      client.from('orders').select('id',{count:'exact',head:true}).eq('order_status','pending')
    ]);
    if(total.error)throw total.error;if(pending.error)throw pending.error;
    document.getElementById('total-orders').textContent=total.count??0;document.getElementById('pending-orders').textContent=pending.count??0;
    ordersBadgeOrderCount=total.count??0;
    setOrdersBadge();
  }
  function orderStatusBadge(value,payment=false){const status=String(value||'pending').toLowerCase();return `<span class="order-status-badge ${payment?'payment':'order'}-status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;}
  function orderFeedback(text,error=false){const el=document.getElementById('orders-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);}
  function orderDetailFeedback(text,error=false){const el=document.getElementById('order-detail-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);}
  async function loadOrders(){
    const rows=document.getElementById('order-rows');rows.innerHTML='<tr><td colspan="7" class="table-message">Loading orders…</td></tr>';
    document.getElementById('orders-mobile-list').innerHTML='<div class="table-message">Loading orders…</div>';orderFeedback('');
    try{
      const {data,error}=await client.from('orders').select('*').order('created_at',{ascending:false});if(error)throw error;
      orderCache=(data||[]).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));updateOrderSummary(orderCache);setOrdersBadge();await renderOrders();
    }catch(error){
      console.error('VC Fashion orders could not be loaded.',error);orderCache=[];
      rows.innerHTML='<tr><td colspan="7" class="table-message">Could not load orders. Check the orders table read policy.</td></tr>';document.getElementById('orders-mobile-list').innerHTML='';orderFeedback('Orders could not be loaded: '+(error.message||'check Supabase access.'),true);
    }
  }
  function callVerificationRequestsFeedback(text,error=false){
    const el=document.getElementById('call-verification-requests-feedback');
    el.textContent=text;
    el.classList.toggle('is-error',error);
    el.classList.toggle('is-success',Boolean(text)&&!error);
  }
  async function loadCallVerificationRequests(){
    const list=document.getElementById('call-verification-request-list');
    list.innerHTML='<p class="table-message">Loading Call Verification Requests…</p>';
    callVerificationRequestsFeedback('');
    try{
      const {data,error}=await client.rpc('admin_list_call_verification_requests');
      if(error)throw error;
      const requests=Array.isArray(data)?data:(typeof data==='string'?JSON.parse(data):[]);
      callVerificationCache=requests;
      setNavBadge('call-verification',requests.filter(request=>String(request.status||'pending')==='pending').length);
      renderCallVerificationRequests();
    }catch(error){
      console.error('VC Fashion Call Verification Requests could not be loaded.',error);
      list.innerHTML='<p class="table-message">Could not load Call Verification Requests.</p>';
      callVerificationRequestsFeedback(error.code==='PGRST202'||/function|schema cache|does not exist/i.test(String(error.message||''))?'Call Verification is unavailable until the reviewed Supabase proposal is applied.':`Requests could not be loaded: ${error.message||'check administrator access.'}`,true);
    }
  }
  // Requests render as compact rows; only the ids tracked in the expanded set
  // show their full details, so expanding one request never touches the others.
  function renderCallVerificationRequests(){
    const list=document.getElementById('call-verification-request-list');
    if(!callVerificationCache.length){list.innerHTML='<p class="table-message">No Call Verification Requests yet.</p>';return;}
    list.innerHTML=callVerificationCache.map(request=>{
      const requestStatus=String(request.status||'pending');
      const variant=[request.size,request.color_name].filter(Boolean).join(' / ')||'Standard';
      const expanded=expandedCallVerificationRequests.has(String(request.id));
      return `<article class="call-verification-request-card">
        <header><div><p class="eyebrow">REQUEST / ${escapeHtml(String(request.id).slice(0,8))}</p><h2>${escapeHtml(request.product_name||'Product')}</h2><div class="call-verification-summary-meta"><span>${escapeHtml(request.customer_name||'Name unavailable')}</span><span>${escapeHtml(variant)}</span>${orderStatusBadge(request.payment_status,true)}<span class="call-verification-request-status">${escapeHtml(requestStatus)}</span></div></div><button class="order-view-button" type="button" data-toggle-call-verification="${escapeHtml(request.id)}" aria-expanded="${expanded}">${expanded?'Hide Details':'View Details'}</button></header>
        ${expanded?`<div class="call-verification-details">
          <dl>
            <div><dt>Request ID</dt><dd class="full-order-id">${escapeHtml(request.id)}</dd></div>
            <div><dt>Created</dt><dd>${escapeHtml(formatOrderDate(request.created_at))}</dd></div>
            <div><dt>Customer</dt><dd>${escapeHtml(request.customer_name||'Name unavailable')}</dd></div>
            <div><dt>Phone</dt><dd>${escapeHtml(request.customer_phone||'Phone unavailable')}</dd></div>
            <div><dt>Variant</dt><dd>${escapeHtml(variant)}</dd></div>
            <div><dt>Variant ID</dt><dd class="full-order-id">${escapeHtml(request.variant_id||'—')}</dd></div>
            <div><dt>Product ID</dt><dd class="full-order-id">${escapeHtml(request.product_id||'—')}</dd></div>
            <div><dt>Order ID</dt><dd class="full-order-id">${escapeHtml(request.order_id)}</dd></div>
            <div><dt>Payment status</dt><dd>${escapeHtml(request.payment_status||'—')}</dd></div>
            <div><dt>Delivery address</dt><dd>${escapeHtml(request.shipping_address||'Not provided')}</dd></div>
            <div><dt>City</dt><dd>${escapeHtml(request.shipping_city||'Not provided')}</dd></div>
            <div><dt>State</dt><dd>${escapeHtml(request.shipping_state||'Not provided')}</dd></div>
            <div><dt>PIN code</dt><dd>${escapeHtml(request.shipping_pincode||'Not provided')}</dd></div>
            ${request.reviewed_at?`<div><dt>Reviewed</dt><dd>${escapeHtml(formatOrderDate(request.reviewed_at))}</dd></div>`:''}
          </dl>
          ${requestStatus==='reviewed'?'<p class="call-verification-reviewed-note">This request has been reviewed.</p>':`<button class="order-view-button" type="button" data-review-call-verification="${escapeHtml(request.id)}">Mark as Reviewed</button>`}
        </div>`:''}
      </article>`;
    }).join('');
  }
  async function reviewCallVerificationRequest(requestId,button){
    if(!requestId||button.disabled)return;
    button.disabled=true;
    callVerificationRequestsFeedback('');
    try{
      const {error}=await client.rpc('admin_review_call_verification_request',{p_request_id:requestId});
      if(error)throw error;
      callVerificationRequestsFeedback('Request marked as Reviewed.');
      await loadCallVerificationRequests();
    }catch(error){
      console.error('VC Fashion call verification request could not be marked Reviewed.',error);
      callVerificationRequestsFeedback(`The request could not be marked Reviewed: ${error.message||'check administrator access.'}`,true);
      button.disabled=false;
    }
  }
  function callVerificationPendingCount(data){
    const requests=Array.isArray(data)?data:(typeof data==='string'?JSON.parse(data):[]);
    return requests.filter(request=>String(request.status||'pending')==='pending').length;
  }
  async function loadCallVerificationBadge(){
    const {data,error}=await client.rpc('admin_list_call_verification_requests');
    if(error)throw error;
    setNavBadge('call-verification',callVerificationPendingCount(data));
  }
  // The admin tables expose no realtime channel, so the sidebar counts also
  // refresh on this interval and whenever the tab regains focus, reusing the
  // exact queries the dashboard and admin sections already rely on.
  async function refreshSidebarBadges(){
    if(!client||dashboardView.hidden)return;
    const [ordersResult,requestsResult,historyResult,variantsResult]=await Promise.all([
      client.from('orders').select('id'),
      client.rpc('admin_list_call_verification_requests'),
      client.rpc('admin_list_order_history'),
      client.from('product_variants').select('product_id,stock')
    ]);
    if(ordersResult.error||historyResult.error)historySyncFailed=true;
    if(!ordersResult.error){ordersBadgeOrderCount=(ordersResult.data||[]).length;setOrdersBadge();}
    if(!historyResult.error){
      const records=Array.isArray(historyResult.data)?historyResult.data:[];
      records.forEach(record=>historyOrderIds.add(String(record.order_id)));
      historySyncFailed=false;
      setOrdersBadge();
    }
    if(!requestsResult.error)setNavBadge('call-verification',callVerificationPendingCount(requestsResult.data));
    if(!variantsResult.error)updateStockMetrics(variantsResult.data||[]);
  }
  function safeRefreshSidebarBadges(){
    refreshSidebarBadges().catch(error=>console.error('VC Fashion sidebar badges could not be refreshed.',error));
  }
  function startSidebarBadgeRefresh(){
    if(sidebarBadgeTimer)return;
    sidebarBadgeTimer=setInterval(safeRefreshSidebarBadges,45000);
  }
  async function renderOrders(){
    const query=document.getElementById('order-search').value.trim().toLowerCase(),orderStatus=document.getElementById('order-status-filter').value,paymentStatus=document.getElementById('payment-status-filter').value;
    const orders=orderCache.filter(order=>{
      const searchable=[order.id,order.customer_name,order.customer_email,order.customer_phone].join(' ').toLowerCase();
      return (!query||searchable.includes(query))&&(!orderStatus||String(order.order_status).toLowerCase()===orderStatus)&&(!paymentStatus||String(order.payment_status).toLowerCase()===paymentStatus);
    });
    const rows=orders.map(order=>`<tr><td><strong class="order-short-id">#${escapeHtml(String(order.id).slice(0,8))}</strong></td><td><div class="order-customer-cell"><strong>${escapeHtml(order.customer_name||'Guest customer')}</strong><small>${escapeHtml(order.customer_email||'—')}</small></div></td><td>${escapeHtml(formatOrderDate(order.created_at))}</td><td><strong>${money(order.total_paise)}</strong></td><td>${orderStatusBadge(order.payment_status,true)}</td><td>${orderStatusBadge(order.order_status)}</td><td><div class="row-actions"><button class="order-view-button" type="button" data-view-order="${escapeHtml(order.id)}">View details</button>${historySaveButton(order)}</div></td></tr>`).join('');
    document.getElementById('order-rows').innerHTML=rows||'<tr><td colspan="7" class="table-message">No orders match these filters.</td></tr>';
    const cards=orders.map(order=>`<article class="order-mobile-card"><div class="order-mobile-head"><div><strong>#${escapeHtml(String(order.id).slice(0,8))}</strong><small>${escapeHtml(formatOrderDate(order.created_at))}</small></div><strong>${money(order.total_paise)}</strong></div><div class="order-mobile-customer"><strong>${escapeHtml(order.customer_name||'Guest customer')}</strong><small>${escapeHtml(order.customer_email||'—')}</small><small>${escapeHtml(order.customer_phone||'—')}</small></div><div class="order-mobile-statuses">${orderStatusBadge(order.payment_status,true)}${orderStatusBadge(order.order_status)}</div><div class="row-actions"><button class="order-view-button" type="button" data-view-order="${escapeHtml(order.id)}">View details</button>${historySaveButton(order)}</div></article>`).join('');
    document.getElementById('orders-mobile-list').innerHTML=cards||'<div class="table-message">No orders match these filters.</div>';
  }
  function historyFeedback(text,error=false){const el=document.getElementById('customer-history-feedback');el.textContent=text;el.classList.toggle('is-error',error);el.classList.toggle('is-success',Boolean(text)&&!error);}
  function historyItemsMarkup(record){
    const items=Array.isArray(record.items)?record.items:[];
    if(!items.length)return '<span>No item details saved.</span>';
    return items.map(item=>`<span>${Number(item.quantity)||0} × ${escapeHtml(item.product_name||'Product')}${item.size||item.color_name?` · ${escapeHtml([item.size,item.color_name].filter(Boolean).join(' / '))}`:''}</span>`).join('');
  }
  function historySaveButton(order){
    const saved=historyOrderIds.has(String(order.id));
    return `<button class="order-history-button" type="button" data-save-order-history="${escapeHtml(order.id)}"${saved?' disabled':''}>${saved?'Saved ✓':'Save to History'}</button>`;
  }
  async function saveOrderToHistory(orderId,button){
    if(!orderId||button.disabled)return;
    button.disabled=true;
    const previousLabel=button.textContent;
    button.textContent='Saving…';
    orderFeedback('');
    try{
      const {data,error}=await client.rpc('admin_save_order_to_history',{p_order_id:String(orderId)});
      if(error)throw error;
      historyOrderIds.add(String(orderId));
      setOrdersBadge();
      button.textContent='Saved ✓';
      const created=!data||typeof data!=='object'||data.created!==false;
      orderFeedback(created?`Order #${String(orderId).slice(0,8)} saved to Customer History.`:'This order is already saved in Customer History.');
    }catch(error){
      console.error('VC Fashion order history save failed.',error);
      button.disabled=false;button.textContent=previousLabel;
      orderFeedback(error.code==='PGRST202'||/function|schema cache|does not exist/i.test(String(error.message||''))?'Customer History is unavailable until the reviewed Supabase proposal is applied.':`Could not save this order to history: ${error.message||'check administrator access.'}`,true);
    }
  }
  async function loadCustomerHistory(){
    const rows=document.getElementById('history-rows');
    rows.innerHTML='<tr><td colspan="7" class="table-message">Loading Customer History…</td></tr>';
    document.getElementById('history-mobile-list').innerHTML='<div class="table-message">Loading Customer History…</div>';
    historyFeedback('');
    try{
      const {data,error}=await client.rpc('admin_list_order_history');
      if(error)throw error;
      const records=Array.isArray(data)?data:(typeof data==='string'?JSON.parse(data):[]);
      records.forEach(record=>historyOrderIds.add(String(record.order_id)));
      historySyncFailed=false;
      setOrdersBadge();
      if(!records.length){
        rows.innerHTML='<tr><td colspan="7" class="table-message">No orders have been saved to Customer History yet.</td></tr>';
        document.getElementById('history-mobile-list').innerHTML='<div class="table-message">No orders have been saved to Customer History yet.</div>';
        return;
      }
      rows.innerHTML=records.map(record=>`<tr><td><div class="order-customer-cell"><strong class="order-short-id">#${escapeHtml(String(record.order_id).slice(0,8))}</strong><small>${orderStatusBadge(record.order_status)}</small></div></td><td><div class="order-customer-cell"><strong>${escapeHtml(record.customer_name||'Guest customer')}</strong><small>${escapeHtml(record.customer_email||'—')}</small><small>${escapeHtml(record.customer_phone||'—')}</small></div></td><td>${escapeHtml(formatOrderDate(record.order_created_at))}</td><td><div class="history-items">${historyItemsMarkup(record)}</div></td><td><strong>${money(record.total_paise)}</strong></td><td>${orderStatusBadge(record.payment_status,true)}</td><td>${escapeHtml(formatOrderDate(record.saved_at))}</td></tr>`).join('');
      document.getElementById('history-mobile-list').innerHTML=records.map(record=>`<article class="order-mobile-card"><div class="order-mobile-head"><div><strong>#${escapeHtml(String(record.order_id).slice(0,8))}</strong><small>${escapeHtml(formatOrderDate(record.order_created_at))}</small></div><strong>${money(record.total_paise)}</strong></div><div class="order-mobile-customer"><strong>${escapeHtml(record.customer_name||'Guest customer')}</strong><small>${escapeHtml(record.customer_email||'—')}</small><small>${escapeHtml(record.customer_phone||'—')}</small></div><div class="history-items">${historyItemsMarkup(record)}</div><div class="order-mobile-statuses">${orderStatusBadge(record.payment_status,true)}${orderStatusBadge(record.order_status)}</div><small class="history-saved-at">Saved ${escapeHtml(formatOrderDate(record.saved_at))}</small></article>`).join('');
    }catch(error){
      console.error('VC Fashion Customer History could not be loaded.',error);
      rows.innerHTML='<tr><td colspan="7" class="table-message">Could not load Customer History.</td></tr>';
      document.getElementById('history-mobile-list').innerHTML='<div class="table-message">Could not load Customer History.</div>';
      historyFeedback(error.code==='PGRST202'||/function|schema cache|does not exist/i.test(String(error.message||''))?'Customer History is unavailable until the reviewed Supabase proposal is applied.':`History could not be loaded: ${error.message||'check administrator access.'}`,true);
      historySyncFailed=true;
    }
  }
  async function openOrderDetails(orderId){
    const modal=document.getElementById('order-details-modal'),content=document.getElementById('order-details-content');
    modal.hidden=false;document.body.classList.add('modal-open');content.innerHTML='<p class="table-message">Loading order details…</p>';orderDetailFeedback('');
    try{
      const [orderResult,itemsResult]=await Promise.all([
        client.from('orders').select('*').eq('id',orderId).single(),
        client.from('order_items').select('*').eq('order_id',orderId).order('created_at',{ascending:true})
      ]);
      if(orderResult.error)throw orderResult.error;if(itemsResult.error)throw itemsResult.error;
      const order=orderResult.data;currentOrder=order;currentOrderItems=itemsResult.data||[];
      const items=await Promise.all((itemsResult.data||[]).map(async item=>({item,image:await imageUrlFor(item.product_image_path||'')})));
      const itemMarkup=items.map(({item,image})=>`<article class="order-item-row"><div class="order-item-visual">${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy">`:'<span class="product-thumb-empty">◇</span>'}</div><div class="order-item-copy"><strong>${escapeHtml(item.product_name||'Product')}</strong><small>SKU ${escapeHtml(item.sku||'—')} · Size ${escapeHtml(item.size||'—')} · ${escapeHtml(item.color_name||'—')}</small><small>Qty ${Number(item.quantity)||0} × ${money(item.unit_price_paise)}</small></div><strong class="order-item-total">${money(item.total_price_paise)}</strong></article>`).join('')||'<p class="table-message">No items are recorded for this order.</p>';
      const orderSelect=orderStatuses.map(status=>`<option value="${status}"${String(order.order_status).toLowerCase()===status?' selected':''}>${status[0].toUpperCase()+status.slice(1)}</option>`).join('');
      const currentPayment=String(order.payment_status||'pending').toLowerCase();
      const paymentSelect=(currentPayment==='paid'?'<option value="paid" selected disabled>Paid · verified by Razorpay</option>':'')+(currentPayment==='refunded'?'<option value="refunded" selected disabled>Refunded · read only</option>':'')+paymentStatuses.map(status=>`<option value="${status}"${currentPayment===status?' selected':''}>${status[0].toUpperCase()+status.slice(1)}</option>`).join('');
      content.innerHTML=`<div class="order-detail-grid"><section class="order-detail-block"><p class="eyebrow">ORDER INFORMATION</p><dl><div><dt>Order ID</dt><dd class="full-order-id">${escapeHtml(order.id)}</dd></div><div><dt>Placed</dt><dd>${escapeHtml(formatOrderDate(order.created_at))}</dd></div><div><dt>Customer</dt><dd>${escapeHtml(order.customer_name||'Guest customer')}</dd></div><div><dt>Email</dt><dd>${escapeHtml(order.customer_email||'—')}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(order.customer_phone||'—')}</dd></div>${order.razorpay_order_id?`<div><dt>Razorpay order</dt><dd class="full-order-id">${escapeHtml(order.razorpay_order_id)}</dd></div>`:''}${order.razorpay_payment_id?`<div><dt>Razorpay payment</dt><dd class="full-order-id">${escapeHtml(order.razorpay_payment_id)}</dd></div>`:''}</dl></section><section class="order-detail-block"><p class="eyebrow">SHIPPING INFORMATION</p><dl><div><dt>Address</dt><dd class="shipping-address">${escapeHtml(order.shipping_address||'—')}</dd></div><div><dt>City</dt><dd>${escapeHtml(order.shipping_city||'—')}</dd></div><div><dt>State</dt><dd>${escapeHtml(order.shipping_state||'—')}</dd></div><div><dt>Pincode</dt><dd>${escapeHtml(order.shipping_pincode||'—')}</dd></div></dl></section></div><section class="order-detail-block order-items-block"><p class="eyebrow">ORDER ITEMS</p><div class="order-items-list">${itemMarkup}</div></section><div class="order-detail-bottom"><section class="order-detail-block order-status-controls"><p class="eyebrow">UPDATE STATUS</p><div class="order-status-control"><label for="detail-order-status">Order status</label><div><select id="detail-order-status">${orderSelect}</select><button type="button" data-save-order-status="order_status">Save</button></div></div><div class="order-status-control"><label for="detail-payment-status">Payment status</label><div><select id="detail-payment-status">${paymentSelect}</select><button type="button" data-save-order-status="payment_status">Save</button></div>${currentPayment==='paid'?'<small>Paid status is set only by verified payment processing.</small>':''}</div></section><section class="order-detail-block order-price-summary"><p class="eyebrow">PRICE SUMMARY</p><dl><div><dt>Subtotal</dt><dd>${money(order.subtotal_paise)}</dd></div><div><dt>Shipping</dt><dd>${money(order.shipping_paise)}</dd></div><div><dt>Discount</dt><dd>−${money(order.discount_paise)}</dd></div><div class="order-grand-total"><dt>Total</dt><dd>
${money(order.total_paise)}</dd></div></dl></section></div><section class="order-detail-block order-invoice-block"><p class="eyebrow">CUSTOMER INVOICE</p><div class="order-invoice-actions"><p>Print a customer copy of this order.<small class="order-invoice-hint">Opens the browser print dialog — choose “Save as PDF” to download. This is not a tax invoice and not a shipping label.</small></p><button type="button" class="order-invoice-button" data-print-invoice>Print / Download Invoice</button></div></section>
<section class="order-detail-block order-status-controls delivery-controls">
  <p class="eyebrow">DELIVERY TRACKING</p>
  <div class="order-status-control">
    <label for="delivery-status">Delivery status</label>
    <select id="delivery-status">
      ${['not_dispatched','dispatched','in_transit','out_for_delivery','delivered'].map(s=>`<option value="${s}"${(order.delivery_status||'not_dispatched')===s?' selected':''}>${s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
    </select>
  </div>
  <div class="order-status-control">
    <label for="delivery-courier">Courier name</label>
    <input id="delivery-courier" value="${escapeHtml(order.courier_name||'')}" maxlength="120" placeholder="e.g. India Post">
  </div>
  <div class="order-status-control">
    <label for="delivery-tracking-number">Tracking number</label>
    <input id="delivery-tracking-number" value="${escapeHtml(order.tracking_number||'')}" maxlength="120" placeholder="Tracking / AWB number">
  </div>
  <div class="order-status-control">
    <label for="delivery-tracking-url">Tracking URL (HTTPS)">
    </label>
    <input id="delivery-tracking-url" type="url" value="${escapeHtml(order.tracking_url||'')}" maxlength="1000" placeholder="https://...">
  </div>
  <div class="order-status-control">
    <label for="delivery-estimated-date">Estimated delivery date</label>
    <input id="delivery-estimated-date" type="date" value="${escapeHtml(order.estimated_delivery_date||'')}">
  </div>
  <button type="button" data-save-delivery>Save delivery details</button>
</section>`;

      content.querySelectorAll('.order-item-visual img').forEach(img=>img.addEventListener('error',()=>{const placeholder=document.createElement('span');placeholder.className='product-thumb-empty';placeholder.textContent='◇';img.replaceWith(placeholder);},{once:true}));
    }catch(error){
      console.error('VC Fashion order details could not be loaded.',error);currentOrder=null;currentOrderItems=[];content.innerHTML='<p class="table-message">Could not load this order. Check the order and order_items read policies.</p>';orderDetailFeedback('Order details failed to load: '+(error.message||'check Supabase access.'),true);
    }
  }
  async function updateOrderStatus(field){
    if(!currentOrder||!['order_status','payment_status'].includes(field))return;
    const select=document.getElementById(field==='order_status'?'detail-order-status':'detail-payment-status'),allowed=field==='order_status'?orderStatuses:paymentStatuses,value=select.value;
    if(!allowed.includes(value)){orderDetailFeedback('Choose a valid status. Refund status is read-only until a provider-confirmed refund flow is available.',true);return;}
    if(field==='payment_status'&&['paid','refunded'].includes(String(currentOrder.payment_status).toLowerCase())&&value!==String(currentOrder.payment_status).toLowerCase()){orderDetailFeedback('Paid and refunded states cannot be changed from this admin screen.',true);return;}
    if(field==='order_status'&&value==='cancelled'&&currentOrder.payment_status==='paid'){orderDetailFeedback('A paid order cannot be cancelled here. Confirm the payment and refund outcome before changing its status.',true);return;}
    if(field==='order_status'&&currentOrder.order_status==='cancelled'&&currentOrder.payment_status==='paid'&&value!=='cancelled'){orderDetailFeedback('This cancelled order has a captured payment and requires manual recovery before it can be reopened.',true);return;}
    if(field==='payment_status'&&value==='refunded'){orderDetailFeedback('Refund status can only be recorded after Razorpay confirms the refund.',true);return;}
    if(String(currentOrder[field]).toLowerCase()===value){orderDetailFeedback('No status change to save.');return;}
    const button=document.querySelector(`[data-save-order-status="${field}"]`);button.disabled=true;orderDetailFeedback('Saving status…');
    try{
      const {data,error}=await client.from('orders').update({[field]:value}).eq('id',currentOrder.id).select('id,order_status,payment_status').single();
      if(error)throw error;if(!data)throw new Error('No order status was updated.');
      const updatedId=currentOrder.id;await loadOrders();await openOrderDetails(updatedId);orderDetailFeedback('Status updated successfully.');
    }catch(error){console.error('VC Fashion order status update failed.',error);orderDetailFeedback('Could not update status: '+(error.message||'check the orders RLS policy.'),true);}
    finally{const activeButton=document.querySelector(`[data-save-order-status="${field}"]`);if(activeButton)activeButton.disabled=false;}
  }
  
  async function saveDeliveryDetails(){
    if(!currentOrder) return;

    const button=document.querySelector('[data-save-delivery]');
    const status=document.getElementById('delivery-status').value;
    const courier=document.getElementById('delivery-courier').value.trim();
    const trackingNumber=document.getElementById('delivery-tracking-number').value.trim();
    const trackingUrl=document.getElementById('delivery-tracking-url').value.trim();
    const date=document.getElementById('delivery-estimated-date').value;

    if(trackingUrl && !/^https:\/\//i.test(trackingUrl)){
      orderDetailFeedback('Tracking URL https:// se shuru hona chahiye.',true);
      return;
    }

    if(currentOrder.payment_status!=='paid' || currentOrder.order_status==='cancelled'){
      orderDetailFeedback('Sirf paid aur non-cancelled order ki delivery update kar sakte ho.',true);
      return;
    }

    if(button) button.disabled=true;
    orderDetailFeedback('Saving delivery details…');

    try{
      const {data,error}=await client.rpc('admin_update_order_delivery',{
        p_order_id:currentOrder.id,
        p_delivery_status:status,
        p_courier_name:courier||null,
        p_tracking_number:trackingNumber||null,
        p_tracking_url:trackingUrl||null,
        p_estimated_delivery_date:date||null
      });

      if(error) throw error;
      if(!data?.success) throw new Error('Delivery update confirm nahi hua.');

      const updatedId=currentOrder.id;
      await loadOrders();
      await openOrderDetails(updatedId);
      orderDetailFeedback('Delivery details successfully saved.');
    }catch(error){
      console.error('Delivery update failed:',error);
      orderDetailFeedback('Delivery save nahi hua: '+(error.message||'Unknown error'),true);
    }finally{
      const activeButton=document.querySelector('[data-save-delivery]');
      if(activeButton) activeButton.disabled=false;
    }
  }

  function printCustomerInvoice(button){
    if(!currentOrder){
      orderDetailFeedback('Load an order first, then use Print / Download Invoice.',true);
      return;
    }
    const invoiceApi=window.VCInvoice;
    if(!invoiceApi||typeof invoiceApi.printInvoice!=='function'){
      orderDetailFeedback('Invoice printing is unavailable because invoice.js did not load. Refresh the page and try again.',true);
      return;
    }
    if(button)button.disabled=true;
    try{
      const result=invoiceApi.printInvoice(currentOrder,currentOrderItems);
      if(result&&result.ok){
        orderDetailFeedback('Invoice opened in a print-ready window. Choose “Save as PDF” in the print dialog to download it.');
      }else{
        orderDetailFeedback('The invoice window was blocked by the browser. Allow pop-ups for this admin page, then press Print / Download Invoice again.',true);
      }
    }catch(error){
      console.error('VC Fashion invoice could not be opened.',error);
      orderDetailFeedback('Could not open the invoice: '+(error.message||'unknown error'),true);
    }finally{
      if(button)button.disabled=false;
    }
  }

  async function handleSession(session) {
    if (authCheckInProgress) return;
    authCheckInProgress = true;
    try {
      if (!session?.user) {
        showView('auth');
        return;
      }
      const authorized = await verifyAdmin(session.user);
      if (!authorized) {
        await client.auth.signOut();
        message('Access denied. This account is not an authorized VC Fashion administrator.');
        showView('auth');
        return;
      }
      await loadDashboard(session.user);
    } catch (error) {
      console.error('VC Fashion admin access check failed.', error);
      await client.auth.signOut().catch(()=>{});
      showView('auth');
      message('We could not verify administrator access. Please try again or contact the project administrator.');
    } finally {
      authCheckInProgress = false;
    }
  }

  if (!client) {
    showView('auth');
    message('Supabase is not available. Check the project configuration and connection.');
    loginButton.disabled = true;
    return;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    message('');
    loginButton.disabled = true;
    loginButton.firstChild.textContent = 'Signing in… ';
    const formData = new FormData(loginForm);
    try {
      const {data,error} = await client.auth.signInWithPassword({email:String(formData.get('email')).trim(),password:String(formData.get('password'))});
      if (error) throw error;
      const authorized = await verifyAdmin(data.user);
      if (!authorized) {
        await client.auth.signOut();
        message('Access denied. This account is not an authorized VC Fashion administrator.');
        return;
      }
      await loadDashboard(data.user);
    } catch (error) {
      console.error('VC Fashion admin sign-in failed.', error);
      await client.auth.signOut().catch(()=>{});
      message(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : 'Sign-in or access verification failed. Please try again.');
    } finally {
      loginButton.disabled = false;
      loginButton.firstChild.textContent = 'Sign in ';
    }
  });

  document.getElementById('logout-button').addEventListener('click', async () => {
    const button = document.getElementById('logout-button');
    button.disabled = true;
    try {
      const {error} = await client.auth.signOut();
      if (error) throw error;
      message('You have been signed out.', true);
      showView('auth');
      loginForm.reset();
    } catch (error) {
      console.error('VC Fashion admin sign-out failed.', error);
      document.getElementById('dashboard-error').textContent = 'Could not sign out. Check your connection and try again.';
    } finally { button.disabled = false; }
  });

  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
    const section=button.dataset.section;
    document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('is-active',item===button));
    document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==section);
    document.getElementById('sidebar').classList.remove('is-open');
    document.getElementById('mobile-menu').setAttribute('aria-expanded','false');
    if(section==='products')loadManagedProducts();
    if(section==='stock')loadStockManagement();
    if(section==='categories')loadManagedCategories();
    if(section==='orders')loadOrders();
    if(section==='customer-history')loadCustomerHistory();
    if(section==='call-verification'){expandedCallVerificationRequests.clear();loadCallVerificationRequests();}
  }));
  document.getElementById('refresh-call-verification-requests').addEventListener('click',loadCallVerificationRequests);
  document.getElementById('refresh-customer-history').addEventListener('click',loadCustomerHistory);
  document.getElementById('call-verification-request-list').addEventListener('click',event=>{
    const toggle=event.target.closest('[data-toggle-call-verification]');
    if(toggle){
      const id=String(toggle.dataset.toggleCallVerification);
      if(expandedCallVerificationRequests.has(id))expandedCallVerificationRequests.delete(id);
      else expandedCallVerificationRequests.add(id);
      renderCallVerificationRequests();
      return;
    }
    const button=event.target.closest('[data-review-call-verification]');
    if(button)reviewCallVerificationRequest(button.dataset.reviewCallVerification,button);
  });
  document.getElementById('add-product-button').addEventListener('click',()=>openProductModal());
  document.getElementById('close-product-modal').addEventListener('click',closeProductModal);
  document.getElementById('cancel-product').addEventListener('click',closeProductModal);
  document.getElementById('product-modal').addEventListener('click',event=>{if(event.target===event.currentTarget)closeProductModal();});
  document.getElementById('product-form').addEventListener('submit',handleProductSave);
  document.getElementById('add-variant-button').addEventListener('click',()=>addVariantRow());
  ['product-search','category-filter','status-filter'].forEach(id=>document.getElementById(id).addEventListener(id==='product-search'?'input':'change',renderManagedProducts));
  document.getElementById('product-rows').addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-product]'),remove=event.target.closest('[data-delete-product]');
    if(edit){const product=productCache.find(item=>String(item.id)===edit.dataset.editProduct);if(product)openProductModal(product);}
    if(remove)deleteProduct(remove.dataset.deleteProduct);
  });
  document.getElementById('product-mobile-list').addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-product]'),remove=event.target.closest('[data-delete-product]');
    if(edit){const product=productCache.find(item=>String(item.id)===edit.dataset.editProduct);if(product)openProductModal(product);}
    if(remove)deleteProduct(remove.dataset.deleteProduct);
  });
  document.getElementById('product-form').elements.name.addEventListener('input',event=>{
    const slug=document.getElementById('product-form').elements.slug;
    if(!slug.dataset.edited)slug.value=event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  });
  document.getElementById('product-form').elements.slug.addEventListener('input',event=>{event.target.dataset.edited='true';});
  document.getElementById('product-media-input').addEventListener('change',event=>{
    const files=[...(event.target.files||[])];
    event.target.value='';
    if(files.length)addMediaFiles(files);
  });
  document.getElementById('media-grid').addEventListener('click',event=>{
    const move=event.target.closest('[data-media-move]'),makeMain=event.target.closest('[data-media-main]'),remove=event.target.closest('[data-media-remove]');
    if(move)moveMediaItem(Number(move.dataset.mediaIndex),Number(move.dataset.mediaMove));
    else if(makeMain)makeMainMediaItem(Number(makeMain.dataset.mediaMain));
    else if(remove)removeMediaItem(Number(remove.dataset.mediaRemove));
  });
  document.getElementById('add-category-button').addEventListener('click',()=>openCategoryModal());
  document.getElementById('close-category-modal').addEventListener('click',()=>closeCategoryModal());
  document.getElementById('cancel-category').addEventListener('click',()=>closeCategoryModal());
  document.getElementById('category-modal').addEventListener('click',event=>{if(event.target===event.currentTarget)closeCategoryModal();});
  document.getElementById('category-form').addEventListener('submit',handleCategorySave);
  document.getElementById('category-rows').addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-category]'),remove=event.target.closest('[data-delete-category]');
    if(edit){const category=categoryCache.find(row=>String(row.id)===edit.dataset.editCategory);if(category)openCategoryModal(category);}
    if(remove)deleteCategory(remove.dataset.deleteCategory);
  });
  document.getElementById('category-mobile-list').addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-category]'),remove=event.target.closest('[data-delete-category]');
    if(edit){const category=categoryCache.find(row=>String(row.id)===edit.dataset.editCategory);if(category)openCategoryModal(category);}
    if(remove)deleteCategory(remove.dataset.deleteCategory);
  });
  ['stock-search','stock-category-filter','stock-status-filter'].forEach(id=>document.getElementById(id).addEventListener(id==='stock-search'?'input':'change',renderStockRows));
  const handleStockAction=event=>{
    const edit=event.target.closest('[data-stock-edit]'),save=event.target.closest('[data-stock-save]'),cancel=event.target.closest('[data-stock-cancel]');
    if(edit){const row=edit.closest('[data-stock-row]');if(row)setStockEditMode(row,true);}
    if(cancel){const row=cancel.closest('[data-stock-row]');if(row)setStockEditMode(row,false);}
    if(save){const row=save.closest('[data-stock-row]');if(row)saveVariantStock(row,save.dataset.stockSave);}
  };
  document.getElementById('stock-rows').addEventListener('click',handleStockAction);
  document.getElementById('stock-mobile-list').addEventListener('click',handleStockAction);
  ['order-search','order-status-filter','payment-status-filter'].forEach(id=>document.getElementById(id).addEventListener(id==='order-search'?'input':'change',renderOrders));
  document.getElementById('refresh-orders').addEventListener('click',loadOrders);
  const handleOrderAction=event=>{
    const view=event.target.closest('[data-view-order]');
    if(view){openOrderDetails(view.dataset.viewOrder);return;}
    const save=event.target.closest('[data-save-order-history]');
    if(save)saveOrderToHistory(save.dataset.saveOrderHistory,save);
  };
  document.getElementById('order-rows').addEventListener('click',handleOrderAction);
  document.getElementById('orders-mobile-list').addEventListener('click',handleOrderAction);
  document.getElementById('close-order-details').addEventListener('click',()=>{document.getElementById('order-details-modal').hidden=true;document.body.classList.remove('modal-open');currentOrder=null;currentOrderItems=[];});
  document.getElementById('order-details-modal').addEventListener('click',event=>{if(event.target===event.currentTarget){event.currentTarget.hidden=true;document.body.classList.remove('modal-open');currentOrder=null;currentOrderItems=[];}});
 
document.getElementById('order-details-content').addEventListener('click',event=>{
  const invoiceButton=event.target.closest('[data-print-invoice]');
  if(invoiceButton){
    printCustomerInvoice(invoiceButton);
    return;
  }

  const deliveryButton=event.target.closest('[data-save-delivery]');
  if(deliveryButton){
    saveDeliveryDetails();
    return;
  }

  const button=event.target.closest('[data-save-order-status]');
  if(button) updateOrderStatus(button.dataset.saveOrderStatus);
});

  document.getElementById('mobile-menu').addEventListener('click',event=>{
    const open=document.getElementById('sidebar').classList.toggle('is-open');
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });

  window.addEventListener('focus',safeRefreshSidebarBadges);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)safeRefreshSidebarBadges();});

  showView('loading');
  client.auth.getSession().then(({data,error})=>{
    if(error) throw error;
    return handleSession(data.session);
  }).catch(error=>{
    console.error('VC Fashion could not restore the admin session.',error);
    showView('auth');
    message('Could not restore your session. Please sign in again.');
  });
  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT') { showView('auth'); return; }
    if(event==='SIGNED_IN' && !authCheckInProgress) handleSession(session);
  });
})();
