(() => {
  const gallery=document.getElementById('detail-gallery');
  const info=document.getElementById('detail-info');
  info.innerHTML='<p class="eyebrow">LOADING THE COLLECTION</p>';
  const ready=window.FORME_CATALOG_READY||Promise.resolve(window.FORME_PRODUCTS||[]);
  ready.then(async products => {
  const {money,imageUrl,isWishlisted}=window.FormeCommerce;
  const params=new URLSearchParams(window.location.search);
  const product=products.find(item=>item.id===params.get('id')||item.dbId===params.get('id')||item.slug===params.get('id'));
  const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

  if(!product){
    gallery.innerHTML='<div class="product-not-found"><span>✳</span><h1>That piece is not here.</h1><p>It may have moved. Browse the full collection to find something you love.</p><a class="button button-dark" href="shop.html">Back to shop <span>↗</span></a></div>';
    info.remove();
    document.title='Product not found — VC Fashion';return;
  }
  if(typeof window.FORME_LOAD_PRODUCT_GALLERY==='function'){
    try{await window.FORME_LOAD_PRODUCT_GALLERY(product);}catch(error){console.warn('VC Fashion could not load the product gallery.',error);}
  }
  let selectedSize=product.defaultSize||(product.sizes.includes('M')?'M':product.sizes[0]);
  let selectedColor=product.defaultColor||product.colors[0];
  const name=escapeHtml(product.name);
  const oldPrice=product.oldPrice?`<span class="old-price">${money(product.oldPrice)}</span>`:'';
  const discount=product.oldPrice?Math.round((product.oldPrice-product.price)/product.oldPrice*100):0;
  const saved=isWishlisted(product.id);
  const sizes=product.sizes.map(size=>`<button class="size-option${size===selectedSize?' selected':''}" type="button" data-size-option="${size}" aria-pressed="${size===selectedSize}">${size}</button>`).join('');
  const colors=product.colors.map((color,index)=>`<button class="color-option${color===selectedColor?' selected':''}" type="button" data-color-option="${color}" aria-label="${escapeHtml(product.colorNames[index]||'Color')}" title="${escapeHtml(product.colorNames[index]||'Color')}" aria-pressed="${color===selectedColor}"><span style="background:${color}"></span></button>`).join('');
  const galleryItems=Array.isArray(product.gallery)?product.gallery.filter(item=>item&&item.url):[];
  const mainMedia=galleryItems.length?galleryItems:[{type:'image',url:product.imageUrl||imageUrl(product.image,1200)}];
  const badgeMarkup=`<span class="product-badge">${discount?`${discount}% OFF`:escapeHtml(product.badge)}</span>`;
  const renderStage=item=>item.type==='video'
    ? `<video class="detail-main-video" src="${escapeHtml(item.url)}" controls playsinline preload="metadata" aria-label="${name} video"></video>`
    : `<img src="${escapeHtml(item.url)}" alt="${name}" width="800" height="1000" decoding="async" fetchpriority="high">`;
  if(mainMedia.length>1||mainMedia[0].type==='video'){
    const thumbs=mainMedia.map((item,index)=>`<button type="button" class="detail-media-thumb${index===0?' selected':''}" data-media-index="${index}" aria-label="View ${item.type==='video'?'video':'image'} ${index+1} of ${mainMedia.length}" aria-pressed="${index===0}">${item.type==='video'?'<span class="detail-media-play" aria-hidden="true">▶</span>':`<img src="${escapeHtml(item.url)}" alt="" loading="lazy">`}</button>`).join('');
    gallery.innerHTML=`<div class="detail-gallery-carousel"><div class="detail-main-image detail-media-stage">${badgeMarkup}${renderStage(mainMedia[0])}</div><div class="detail-media-strip" role="group" aria-label="Product media">${thumbs}</div></div>`;
    gallery.querySelectorAll('[data-media-index]').forEach(button=>button.addEventListener('click',()=>{
      const item=mainMedia[Number(button.dataset.mediaIndex)],stage=gallery.querySelector('.detail-media-stage');
      if(!item||!stage)return;
      const badge=stage.querySelector('.product-badge');
      stage.innerHTML='';
      if(badge)stage.append(badge);
      stage.insertAdjacentHTML('beforeend',renderStage(item));
      gallery.querySelectorAll('[data-media-index]').forEach(option=>{const active=option===button;option.classList.toggle('selected',active);option.setAttribute('aria-pressed',String(active));});
    }));
  }else{
    gallery.innerHTML=`<div class="detail-main-image">${badgeMarkup}${renderStage(mainMedia[0])}</div>`;
  }
  const rating=Number(product.rating);
  const ratingMarkup=Number.isFinite(rating)&&rating>0?`<p class="detail-rating">Rating <strong>${rating.toFixed(1)} / 5</strong></p>`:'';
  const description=String(product.description||'').trim();
  const descriptionMarkup=description?`<p class="detail-summary">${escapeHtml(description)}</p>`:'';
  info.innerHTML=`<p class="eyebrow">${escapeHtml(product.category.toUpperCase())} / VC FASHION EVERYDAY</p><h1>${name}</h1>${ratingMarkup}<div class="detail-price">${money(product.price)}${oldPrice}</div>${descriptionMarkup}<div class="variant-heading"><strong>Colour</strong><span id="selected-color-name">${escapeHtml(product.colorNames[product.colors.indexOf(selectedColor)]||'Color')}</span></div><div class="detail-colors">${colors}</div><div class="variant-heading size-heading"><strong>Size</strong></div><div class="detail-sizes">${sizes}</div><p class="size-feedback" id="size-feedback" aria-live="polite"></p><div class="detail-actions"><button class="detail-add-button" id="detail-add-button" type="button" data-add-cart="${product.id}" data-size="${selectedSize}" data-color="${selectedColor}">Add to bag <span>↗</span></button><button class="detail-buy-button" id="detail-buy-button" type="button">Buy now <span aria-hidden="true">↗</span></button><button class="detail-wishlist${saved?' is-saved':''}" type="button" data-wishlist="${product.id}" aria-label="${saved?'Remove':'Add'} ${name} ${saved?'from':'to'} favourites" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div><button class="detail-share-button share-product-button" type="button" data-share-product="${escapeHtml(product.id)}" data-share-name="${name}" data-share-price="${Number(product.price)||0}" aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2"></path></svg><span>Share Product</span></button>`;
  document.getElementById('breadcrumb-name').textContent=product.name;
  document.title=`${product.name} — VC Fashion`;
  const related=products.filter(item=>item.id!==product.id&&item.category===product.category).slice(0,4);
  const fallback=products.filter(item=>item.id!==product.id&&!related.includes(item)).slice(0,4-related.length);
  document.getElementById('related-grid').innerHTML=[...related,...fallback].slice(0,4).map(item=>`<article class="product-card"><div class="product-image"><span class="product-badge">${escapeHtml(item.badge)}</span><a class="product-image-link" href="product.html?id=${encodeURIComponent(item.id)}" aria-label="View ${escapeHtml(item.name)}"><img src="${item.imageUrl||imageUrl(item.image)}" alt="${escapeHtml(item.name)}" width="600" height="760" loading="lazy" decoding="async"></a><button class="wishlist-button${isWishlisted(item.id)?' is-saved':''}" type="button" data-wishlist="${item.id}" aria-label="Save ${escapeHtml(item.name)} to favourites" aria-pressed="${isWishlisted(item.id)}">${isWishlisted(item.id)?'♥':'♡'}</button><button class="quick-add" type="button" data-add-cart="${item.id}" data-size="${item.defaultSize||'M'}" data-color="${item.defaultColor||item.colors[0]||''}">Add to bag <span>+</span></button></div><div class="product-info"><div class="product-topline"><a class="product-name product-name-link" href="product.html?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a><span class="product-rating"><span>★</span> ${Number(item.rating||0).toFixed(1)}</span></div><div class="product-meta"><span class="product-price">${money(item.price)}${item.oldPrice?`<span class="old-price">${money(item.oldPrice)}</span>`:''}</span></div></div></article>`).join('');

  function updateVariantStock(){
    const variants=product.variants||[];
    const available=variant=>product.source!=='supabase'||(Number.isInteger(Number(variant.stock))&&Number(variant.stock)>0);
    document.querySelectorAll('[data-size-option]').forEach(button=>{
      const hasOption=variants.some(variant=>variant.size===button.dataset.sizeOption&&variant.color_hex===selectedColor&&available(variant));
      button.disabled=variants.length>0&&!hasOption;
    });
    document.querySelectorAll('[data-color-option]').forEach(button=>{
      const hasOption=variants.some(variant=>variant.color_hex===button.dataset.colorOption&&variant.size===selectedSize&&available(variant));
      button.disabled=variants.length>0&&!hasOption;
    });
    const variant=variants.find(item=>item.size===selectedSize&&item.color_hex===selectedColor);
    const addButton=document.getElementById('detail-add-button');
    const buyButton=document.getElementById('detail-buy-button');
    const feedback=document.getElementById('size-feedback');
    const soldOut=product.source==='supabase'?(!variant||!available(variant)):(variants.length>0&&(!variant||!available(variant)));
    addButton.disabled=soldOut;
    buyButton.disabled=product.source!=='supabase'||!variant||!Number.isInteger(Number(variant.stock))||Number(variant.stock)<=0;
    feedback.classList.remove('is-error');
    feedback.textContent=soldOut?'This size and colour are out of stock.':(variant&&variant.stock!==null&&variant.stock!==undefined&&Number.isFinite(Number(variant.stock))?`${variant.stock} in stock.`:'');
  }

  document.getElementById('detail-buy-button').addEventListener('click',async event=>{
    const button=event.currentTarget;
    const variant=(product.variants||[]).find(item=>item.size===selectedSize&&item.color_hex===selectedColor);
    if(button.disabled||!variant||!Number.isInteger(Number(variant.stock))||Number(variant.stock)<1){
      document.getElementById('size-feedback').textContent='This size and colour are out of stock.';
      return;
    }
    if(!window.FORME_SUPABASE){
      document.getElementById('size-feedback').textContent='Secure checkout is unavailable. Please try again later.';
      return;
    }
    button.disabled=true;
    button.dataset.originalLabel=button.innerHTML;
    button.innerHTML='Preparing checkout <span aria-hidden="true">…</span>';
    document.getElementById('size-feedback').classList.remove('is-error');
    try{
      const intent={id:product.id,size:selectedSize,color:selectedColor,quantity:1};
      sessionStorage.setItem('forme-buy-now-item',JSON.stringify(intent));
      const {data,error}=await window.FORME_SUPABASE.auth.getSession();
      if(error)throw error;
      const returnTo='checkout.html?buy_now=1';
      window.location.assign(data.session?.user?returnTo:`auth.html?mode=login&return=${encodeURIComponent(returnTo)}`);
    }catch(error){
      console.error('VC Fashion Buy Now could not prepare checkout.',error);
      button.disabled=false;
      button.innerHTML=button.dataset.originalLabel;
      delete button.dataset.originalLabel;
      const feedback=document.getElementById('size-feedback');
      feedback.textContent='We could not start secure checkout. Please try again.';
      feedback.classList.add('is-error');
    }
  });

  document.querySelectorAll('[data-size-option]').forEach(button=>button.addEventListener('click',()=>{
    selectedSize=button.dataset.sizeOption;
    document.querySelectorAll('[data-size-option]').forEach(option=>{const active=option===button;option.classList.toggle('selected',active);option.setAttribute('aria-pressed',String(active));});
    document.getElementById('detail-add-button').dataset.size=selectedSize;
    updateVariantStock();
  }));
  document.querySelectorAll('[data-color-option]').forEach(button=>button.addEventListener('click',()=>{
    selectedColor=button.dataset.colorOption;
    document.querySelectorAll('[data-color-option]').forEach(option=>{const active=option===button;option.classList.toggle('selected',active);option.setAttribute('aria-pressed',String(active));});
    document.getElementById('selected-color-name').textContent=product.colorNames[product.colors.indexOf(selectedColor)];
    document.getElementById('detail-add-button').dataset.color=selectedColor;
    updateVariantStock();
  }));
  updateVariantStock();
  window.addEventListener('forme:wishlist',()=>{
    const button=document.querySelector('.detail-wishlist');if(!button)return;
    const active=isWishlisted(product.id);button.classList.toggle('is-saved',active);button.setAttribute('aria-pressed',String(active));button.textContent=active?'♥':'♡';
  });
  document.getElementById('menu-toggle').addEventListener('click',event=>{
    const button=event.currentTarget,open=button.getAttribute('aria-expanded')==='true';
    button.setAttribute('aria-expanded',String(!open));document.getElementById('main-nav').classList.toggle('is-open',!open);
  });
  document.querySelectorAll('#main-nav a').forEach(link=>link.addEventListener('click',()=>{
    document.getElementById('menu-toggle').setAttribute('aria-expanded','false');document.getElementById('main-nav').classList.remove('is-open');
  }));
  });
})();
