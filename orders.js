// Read-only customer order history. RLS remains the authority for every query.
(() => {
  const client=window.FORME_SUPABASE;
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=paise=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2}).format((Number(paise)||0)/100);
  const formatDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'Date unavailable':new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(date);};
  const orderIdFromUrl=new URLSearchParams(window.location.search).get('id');
  const imageBucket='product-images';
  const imageExpirySeconds=3600;
  const hostname=window.location.hostname||'';
  const imageDebug=window.location.protocol==='file:'||hostname==='localhost'||hostname==='127.0.0.1'||hostname.endsWith('.local');
  let activeUser=null;

  $('orders-back-button').addEventListener('click',()=>{
    try{
      const previousPage=new URL(document.referrer);
      if(previousPage.origin===window.location.origin&&previousPage.href!==window.location.href){
        window.history.back();
        return;
      }
    }catch{}
    window.location.assign('index.html');
  });

  function hideViews(){['orders-loading','orders-auth-required','orders-error','orders-empty','orders-list-view','order-detail-view'].forEach(id=>$(id).hidden=true);}
  function loading(){hideViews();$('orders-loading').hidden=false;}
  function showAuthRequired(){hideViews();$('orders-list').innerHTML='';$('order-detail-view').innerHTML='';$('orders-auth-required').hidden=false;}
  function showError(message){hideViews();$('orders-error').hidden=false;if(message)$('orders-error').querySelector('p').textContent=message;}
  function setAccountControls(user){
    const authLink=$('orders-auth-link'),logout=$('orders-logout');
    authLink.hidden=Boolean(user);
    logout.hidden=!user;
    const returnTo=window.location.pathname+window.location.search+window.location.hash;
    const signInUrl=`auth.html?mode=login&return=${encodeURIComponent(returnTo)}`;
    const signUpUrl=`auth.html?mode=signup&return=${encodeURIComponent(returnTo)}`;
    authLink.href=signInUrl;
    $('orders-login').href=signInUrl;
    $('orders-signup').href=signUpUrl;
  }
  function statusClass(value){const valid=['pending','confirmed','processing','shipped','delivered','cancelled','paid','failed','refunded'];const status=String(value||'pending').toLowerCase();return valid.includes(status)?`status-${status}`:'status-unknown';}
  function statusLabel(value){const text=String(value||'pending');return text.charAt(0).toUpperCase()+text.slice(1).toLowerCase();}
  function statusPill(value,payment=false){return `<span class="order-status-pill ${payment?'payment-status ':''}${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;}
  function shortId(id){return String(id).slice(0,8).toUpperCase();}
  async function requireUser(){
    if(!client)return null;
    const {data:sessionData,error:sessionError}=await client.auth.getSession();
    if(sessionError)throw sessionError;
    if(!sessionData?.session?.user)return null;
    const {data:userData,error:userError}=await client.auth.getUser();
    if(userError)throw userError;
    if(!userData?.user?.id)return null;
    return userData.user;
  }

  function renderList(orders){
    hideViews();
    if(!orders.length){$('orders-list').innerHTML='';$('orders-count').textContent='';$('orders-empty').hidden=false;return;}
    $('orders-count').textContent=`${orders.length} ${orders.length===1?'order':'orders'}`;
    $('orders-list').innerHTML=orders.map(order=>`<article class="customer-order-card"><div class="customer-order-top"><div><p class="eyebrow">ORDER / ${escapeHtml(formatDate(order.created_at))}</p><h3>#${escapeHtml(shortId(order.id))}</h3><span class="customer-order-full-id">${escapeHtml(order.id)}</span></div><strong class="customer-order-total">${money(order.total_paise)}</strong></div><div class="customer-order-statuses"><div><small>ORDER STATUS</small>${statusPill(order.order_status)}</div><div><small>PAYMENT STATUS</small>${statusPill(order.payment_status,true)}</div></div><div class="customer-order-actions"><a class="customer-order-view" href="orders.html?id=${encodeURIComponent(order.id)}">View order details <span aria-hidden="true">↗</span></a></div></article>`).join('');
    $('orders-list-view').hidden=false;
  }

  async function loadList(user){
    loading();
    const {data,error}=await client.from('orders')
      .select('id,user_id,created_at,total_paise,payment_status,order_status')
      .eq('user_id',user.id)
      .order('created_at',{ascending:false});
    if(error)throw error;
    renderList(data||[]);
  }

  function diagnosticPath(value){
    if(typeof value!=='string')return value??null;
    const trimmed=value.trim();
    if(/^https?:\/\//i.test(trimmed)){try{const url=new URL(trimmed);return `${url.origin}${url.pathname}`;}catch{return '[invalid storage URL]';}}
    return trimmed.split(/[?#]/,1)[0];
  }

  function normalizeStoragePath(value){
    if(typeof value!=='string'||!value.trim())return null;
    let path=value.trim();
    if(/^https?:\/\//i.test(path)||path.startsWith('/storage/v1/object/')){
      let url;
      try{url=new URL(path,window.location.origin);}catch{return null;}
      const match=url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)$/i);
      if(!match)return null;
      let bucket,objectPath;
      try{bucket=decodeURIComponent(match[1]);objectPath=decodeURIComponent(match[2]);}catch{return null;}
      if(bucket!==imageBucket)return null;
      path=objectPath;
    }else{
      path=path.split(/[?#]/,1)[0];
      try{path=decodeURIComponent(path);}catch{return null;}
    }
    path=path.replace(/^\/+/, '').trim();
    if(path===imageBucket)return null;
    if(path.startsWith(`${imageBucket}/`))path=path.slice(imageBucket.length+1);
    if(!path||path.split('/').some(segment=>!segment||segment==='.'||segment==='..'))return null;
    return path;
  }

  function isValidProductStoragePath(path){
    if(typeof path!=='string')return false;
    const segments=path.split('/');
    return segments.length>=3&&segments[0]==='products'&&segments.slice(1).every(segment=>Boolean(segment)&&segment!=='.'&&segment!=='..');
  }

  function imageDiagnostic(level,message,details){if(level==='error'||level==='warn'||imageDebug)console[level](`[VC Fashion My Orders image] ${message}`,details);}

  async function signedImage(path){
    const normalizedPath=normalizeStoragePath(path);
    const validPath=isValidProductStoragePath(normalizedPath);
    const diagnostic={product_image_path:diagnosticPath(path),normalized_path:normalizedPath,bucket:imageBucket,expiry_seconds:imageExpirySeconds};
    if(!validPath){imageDiagnostic('warn','Image path is not a valid product Storage object path; signing was skipped.',{...diagnostic,path_validation:'expected products/<product-id>/<filename>'});return null;}
    if(!client){imageDiagnostic('error','Supabase client is unavailable; signed URL was not requested.',diagnostic);return null;}
    try{
      const {data,error}=await client.storage.from(imageBucket).createSignedUrl(normalizedPath,imageExpirySeconds);
      if(error){
        imageDiagnostic('error','Supabase Storage could not sign the product image path.',{...diagnostic,message:error.message||String(error),status:error.status??null,statusCode:error.statusCode??null,name:error.name??null});
        return null;
      }
      if(!data?.signedUrl){imageDiagnostic('error','Supabase Storage returned no signed URL.',{...diagnostic,status:'missing_signed_url'});return null;}
      let signedHost=null;try{signedHost=new URL(data.signedUrl).host;}catch{/* host stays unavailable */}
      imageDiagnostic('debug','Signed URL created successfully.',{...diagnostic,signed_url_returned:true,signed_url_host:signedHost});
      return data.signedUrl;
    }catch(error){
      imageDiagnostic('error','Unexpected error while signing product image path.',{...diagnostic,message:error?.message||String(error),status:error?.status??null,statusCode:error?.statusCode??null,name:error?.name??null});
    }
    return null;
  }

  function renderCallVerificationAction(container,order,item,request=null){
    container.replaceChildren();
    if(request){
      const status=document.createElement('span');
      status.className='call-verification-status';
      status.setAttribute('role','status');
      status.textContent=`Call verification requested · ${request.status==='reviewed'?'Reviewed':'Pending'}`;
      container.append(status);
      return;
    }
    const button=document.createElement('button');
    button.className='call-verification-button';
    button.type='button';
    button.dataset.orderId=String(order.id);
    button.dataset.orderItemId=String(item.id);
    button.textContent='📞 Request Call Verification — Free';
    container.append(button);
  }

  async function requestCallVerification(button){
    if(button.disabled)return;
    const orderId=button.dataset.orderId;
    const orderItemId=button.dataset.orderItemId;
    button.disabled=true;
    button.textContent='Submitting request…';
    try{
      const {data,error}=await client.rpc('create_call_verification_request',{
        p_order_id:orderId,
        p_order_item_id:orderItemId
      });
      if(error)throw error;
      const request=typeof data==='string'?JSON.parse(data):data;
      if(!request?.id||!['pending','reviewed'].includes(request.status))throw new Error('The request response was incomplete.');
      const order={id:orderId};
      const item={id:orderItemId};
      renderCallVerificationAction(button.parentElement,order,item,request);
      $('orders-feedback').hidden=true;
    }catch(error){
      console.error('VC Fashion call verification request could not be saved.',error);
      button.disabled=false;
      button.textContent='📞 Request Call Verification — Free';
      const feedback=$('orders-feedback');
      feedback.textContent=error.code==='PGRST202'||/function|schema cache|does not exist/i.test(String(error.message||''))?
        'Call Verification is unavailable until the reviewed Supabase proposal is applied.':
        `Your request could not be saved: ${error.message||'please retry.'}`;
      feedback.hidden=false;
    }
  }

  async function loadDetail(user,orderId){
    loading();
   
const {data:order,error:orderError}=await client.from('orders')
  .select('id,user_id,created_at,customer_name,customer_email,customer_phone,shipping_address,shipping_city,shipping_state,shipping_pincode,subtotal_paise,shipping_paise,discount_paise,total_paise,payment_status,order_status,delivery_status,courier_name,tracking_number,tracking_url,estimated_delivery_date,dispatched_at,delivered_at')
  .eq('id',orderId)
  .eq('user_id',user.id)
  .maybeSingle();
if(orderError)throw orderError;
    if(!order){hideViews();$('orders-error').hidden=false;$('orders-error').querySelector('h2').textContent='We couldn’t find that order.';$('orders-error').querySelector('p').textContent='It may not belong to this account, or it may no longer be available.';return;}
    const {data:items,error:itemError}=await client.from('order_items')
      .select('id,product_id,variant_id,product_name,product_image_path,sku,size,color_name,quantity,unit_price_paise,total_price_paise,created_at')
      .eq('order_id',order.id)
      .order('created_at',{ascending:true});
    if(itemError)throw itemError;
    let callRequests=[];
    let callRequestsError=null;
    const callEligible=String(order.payment_status).toLowerCase()==='paid'&&String(order.order_status).toLowerCase()!=='cancelled';
    if(callEligible){
      const {data:requestData,error:requestError}=await client.rpc('customer_list_call_verification_requests',{p_order_id:String(order.id)});
      if(requestError){
        callRequestsError=requestError;
        console.error('VC Fashion call verification requests could not be loaded.',requestError);
      }else callRequests=Array.isArray(requestData)?requestData:(typeof requestData==='string'?JSON.parse(requestData):[]);
    }
    const renderedItems=await Promise.all((items||[]).map(async item=>({...item,signedImage:await signedImage(item.product_image_path)})));
    hideViews();
    $('order-detail-view').innerHTML=`<a class="orders-back-link" href="orders.html">← All orders</a><div class="order-detail-heading"><div><p class="eyebrow">YOUR ORDER / ${escapeHtml(formatDate(order.created_at))}</p><h2>Order <em>#${escapeHtml(shortId(order.id))}</em></h2><p class="order-detail-full-id">${escapeHtml(order.id)}</p></div><div class="customer-order-statuses">${statusPill(order.order_status)}${statusPill(order.payment_status,true)}</div></div><div class="customer-order-detail-grid"><section class="customer-order-panel customer-items-panel"><p class="eyebrow">ORDER ITEMS</p><div class="customer-order-items">${renderedItems.length?renderedItems.map(item=>`<article class="customer-order-item"><div class="customer-order-image-wrap">${item.signedImage?`<img class="customer-order-image" src="${escapeHtml(item.signedImage)}" alt="${escapeHtml(item.product_name||'Ordered product')}" loading="lazy">`:'<span class="customer-order-image-placeholder" role="img" aria-label="Image unavailable">Image unavailable</span>'}</div><div class="customer-item-copy"><h3>${escapeHtml(item.product_name||'Product')}</h3><p>Size ${escapeHtml(item.size||'—')} · ${escapeHtml(item.color_name||'—')}</p><p>SKU ${escapeHtml(item.sku||'—')} · Quantity ${Number(item.quantity)||0}</p></div><div class="customer-item-prices"><strong>${money(item.total_price_paise)}</strong><small>${money(item.unit_price_paise)} each</small></div></article>`).join(''):'<p class="order-no-items">No item details are available for this order.</p>'}</div></section><aside class="customer-order-side"><section class="customer-order-panel"><p class="eyebrow">DELIVERY DETAILS</p><dl class="customer-shipping-details"><div><dt>Recipient</dt><dd>${escapeHtml(order.customer_name||'—')}</dd></div><div><dt>Phone</dt><dd>${escapeHtml(order.customer_phone||'—')}</dd></div><div><dt>Email</dt><dd>${escapeHtml(order.customer_email||'—')}</dd></div><div><dt>Address</dt><dd>${escapeHtml(order.shipping_address||'—')}</dd></div><div><dt>City / State</dt><dd>${escapeHtml(order.shipping_city||'—')}, ${escapeHtml(order.shipping_state||'—')}</dd></div><div><dt>Pincode</dt><dd>${escapeHtml(order.shipping_pincode||'—')}</dd></div></dl></section>
<section class="customer-order-panel customer-tracking-panel">
  <p class="eyebrow">DELIVERY TRACKING</p>
  <p><strong>Status:</strong> ${escapeHtml(String(order.delivery_status||'not_dispatched').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()))}</p>
  ${order.courier_name?`<p><strong>Courier:</strong> ${escapeHtml(order.courier_name)}</p>`:''}
  ${order.tracking_number?`<p><strong>Tracking number:</strong> ${escapeHtml(order.tracking_number)}</p>`:''}
  ${order.estimated_delivery_date?`<p><strong>Estimated delivery:</strong> ${escapeHtml(order.estimated_delivery_date)}</p>`:''}
  ${order.tracking_url?`<a href="${escapeHtml(order.tracking_url)}" target="_blank" rel="noopener noreferrer">Track Package ↗</a>`:''}
</section>
<p class="eyebrow">PRICE SUMMARY</p><dl><div><dt>Subtotal</dt><dd>${money(order.subtotal_paise)}</dd></div><div><dt>Shipping</dt><dd>${money(order.shipping_paise)}</dd></div><div><dt>Discount</dt><dd>−${money(order.discount_paise)}</dd></div><div class="customer-grand-total"><dt>Total</dt><dd>${money(order.total_paise)}</dd></div></dl></section></aside></div><p class="customer-readonly-note">Order and payment statuses are read-only. For help with this order, contact VC Fashion support.</p>`;
    $('order-detail-view').querySelectorAll('.customer-order-image').forEach(image=>image.addEventListener('error',()=>{
      const placeholder=document.createElement('span');
      placeholder.className='customer-order-image-placeholder';
      placeholder.setAttribute('role','img');
      placeholder.setAttribute('aria-label','Image unavailable');
      placeholder.textContent='Image unavailable';
      image.replaceWith(placeholder);
    },{once:true}));
    if(callEligible){
      const requestsByItem=new Map(callRequests.map(request=>[String(request.order_item_id),request]));
      $('order-detail-view').querySelectorAll('.customer-order-item').forEach((itemCard,index)=>{
        const item=renderedItems[index];
        const action=document.createElement('div');
        action.className='call-verification-action';
        itemCard.querySelector('.customer-item-copy').append(action);
        if(callRequestsError){
          action.textContent='Call Verification status is temporarily unavailable.';
        }else renderCallVerificationAction(action,order,item,requestsByItem.get(String(item.id))||null);
      });
      if(callRequestsError){
        const feedback=$('orders-feedback');
        feedback.textContent='Order details loaded, but Call Verification status could not be loaded. Please refresh the order.';
        feedback.hidden=false;
      }
    }
    $('order-detail-view').hidden=false;
  }

  async function init(){
    if(!client){setAccountControls(null);showError('Account services are unavailable. Check the Supabase configuration and try again.');return;}
    $('orders-list').innerHTML='';
    $('order-detail-view').innerHTML='';
    loading();
    try{
      activeUser=await requireUser();
      if(!activeUser){setAccountControls(null);showAuthRequired();return;}
      setAccountControls(activeUser);
      if(orderIdFromUrl)await loadDetail(activeUser,orderIdFromUrl);
      else await loadList(activeUser);
    }catch(error){console.error('VC Fashion customer orders could not be loaded.',error);showError('We could not verify your account or load your orders. Check your connection and try again.');}
  }

  $('orders-retry').addEventListener('click',init);
  $('order-detail-view').addEventListener('click',event=>{
    const button=event.target.closest('.call-verification-button');
    if(button)requestCallVerification(button);
  });
  $('orders-logout').addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try{
      const {error}=await client.auth.signOut();
      if(error)throw error;
      activeUser=null;
      setAccountControls(null);
      showAuthRequired();
      $('orders-feedback').hidden=true;
    }catch(error){
      console.error('VC Fashion customer sign-out failed.',error);
      const feedback=$('orders-feedback');
      feedback.textContent='Could not sign out. Check your connection and try again.';
      feedback.hidden=false;
    }finally{button.disabled=false;}
  });
  client?.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){activeUser=null;setAccountControls(null);showAuthRequired();}
    if(event==='SIGNED_IN')init();
  });
  setAccountControls(null);
  init();
})();
