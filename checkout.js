// Checkout always resolves cart choices and prices against the current Supabase rows.
(() => {
  const client = window.FORME_SUPABASE;
  const $ = id => document.getElementById(id);
  $('checkout-back-button').addEventListener('click', () => {
    try {
      const previousPage = new URL(document.referrer);
      if (previousPage.origin === window.location.origin && previousPage.href !== window.location.href) {
        window.history.back();
        return;
      }
    } catch {}
    window.location.assign('index.html');
  });
  const money = paise => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format((Number(paise)||0)/100);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let checkoutUserId=null;
  const readCart = () => window.FormeCommerce?.getCart(checkoutUserId)||[];
  const buyNowMode=new URLSearchParams(window.location.search).get('buy_now')==='1';
  const buyNowIntentKey='forme-buy-now-item';
  let buyNowItem=null,buyNowError=null;
  if(buyNowMode){
    try{
      const value=JSON.parse(sessionStorage.getItem(buyNowIntentKey)||'null');
      if(!value||typeof value.id!=='string'||!value.id||typeof value.size!=='string'||!value.size||typeof value.color!=='string'||!value.color||!Number.isSafeInteger(value.quantity)||value.quantity!==1)throw new Error('The Buy Now selection is unavailable or invalid.');
      buyNowItem=value;
    }catch(error){buyNowError=error;}
  }
  let cart = buyNowMode?(buyNowItem?[buyNowItem]:[]):readCart();
  let lines = [];
  let submitting = false;
  const pendingPaymentKey=buyNowMode?'forme-buy-now-pending-payment':'forme-checkout-pending-payment';
  let pendingPaymentMemory=null;
  function readPendingPayments(){
    let entries=pendingPaymentMemory;
    if(entries===null){
      let saved;
      try{saved=JSON.parse(sessionStorage.getItem(pendingPaymentKey)||'null');}catch{saved=null;}
      entries=Array.isArray(saved)?saved:saved?[saved]:[];
    }
    return entries.filter(value=>value&&typeof value.orderId==='string'&&(!value.userId||value.userId===checkoutUserId));
  }
  function storePendingPayment(value){
    const pending=readPendingPayments().filter(entry=>entry.orderId!==value.orderId);
    pending.push(value);pendingPaymentMemory=pending;
    try{sessionStorage.setItem(pendingPaymentKey,JSON.stringify(pending));}catch{/* Keep retry capabilities in this page's memory. */}
  }
  function clearPendingPayment(orderId){
    pendingPaymentMemory=readPendingPayments().filter(entry=>entry.orderId!==orderId);
    try{sessionStorage.setItem(pendingPaymentKey,JSON.stringify(pendingPaymentMemory));}catch{/* The in-memory capability is cleared regardless. */}
  }
  let imagePlaceholder = 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150"><rect width="120" height="150" fill="#eeede7"/><text x="60" y="80" text-anchor="middle" font-family="sans-serif" font-size="11" letter-spacing="2" fill="#969586">VC FASHION</text></svg>');
  let confirmationMemory=null;

  function feedback(message,type='info') { const node=$('checkout-feedback');node.textContent=message;node.className=`checkout-feedback${type==='error'?' is-error':type==='success'?' is-success':''}`;node.hidden=!message; }
  function saveCheckoutDetails() {
    const fields={};
    for(const field of $('checkout-form').elements)if(field.name)fields[field.name]=field.value;
    sessionStorage.setItem('forme-checkout-return-state',JSON.stringify({fields}));
  }
  function restoreCheckoutDetails() {
    const key='forme-checkout-return-state';
    try {
      const saved=JSON.parse(sessionStorage.getItem(key)||'null');
      if(!saved)return;
      for(const [name,value] of Object.entries(saved.fields||{})){
        const field=$('checkout-form').elements.namedItem(name);
        if(field&&typeof value==='string')field.value=value;
      }
      sessionStorage.removeItem(key);
    } catch(error) {
      console.error('VC Fashion checkout details could not be restored.',error);
      try{sessionStorage.removeItem(key);}catch{}
      feedback('Your saved checkout details could not be restored. Please review and re-enter them.','error');
    }
  }
  function redirectToLogin() {
    try{saveCheckoutDetails();}
    catch(error){console.error('VC Fashion checkout details could not be saved before sign-in.',error);feedback('We could not save your checkout details before sign-in. Please try again.','error');return false;}
    const returnTo=window.location.pathname+window.location.search+window.location.hash;
    const loginUrl=new URL('auth.html',window.location.href);
    loginUrl.searchParams.set('mode','login');
    loginUrl.searchParams.set('return',returnTo);
    window.location.assign(loginUrl.toString());
    return true;
  }
  function isExpiredSessionError(error) {
    const code=String(error?.code||'').toLowerCase();
    const name=String(error?.name||'').toLowerCase();
    const message=String(error?.message||'').toLowerCase();
    return error?.status===401
      ||['session_not_found','auth_session_missing','refresh_token_not_found','invalid_refresh_token','bad_jwt','invalid_jwt'].includes(code)
      ||name==='authsessionmissingerror'
      ||/auth session missing|jwt expired|session expired|invalid refresh token|refresh token not found/.test(message);
  }
  function cartKey(item) { return `${item.id}|${item.size}|${item.color}`; }
  function currentTotals() { const subtotal=lines.reduce((sum,line)=>sum+(line.pricePaise||0)*(Number(line.cartItem.quantity)||0),0);const shipping=subtotal>=99900?0:subtotal?9900:0;return {subtotal,shipping,discount:0,total:subtotal+shipping}; }
  function validateDeliveryDetails() {
    const form=$('checkout-form');
    const phone=form.elements.customer_phone;
    const phoneValue=phone.value.trim();
    const phoneDigits=phoneValue.replace(/\D/g,'').length;
    const phoneInvalid=Boolean(phoneValue)&&(!/^[+()\-\s\d]{7,20}$/.test(phoneValue)||phoneDigits<10||phoneDigits>15);
    phone.setCustomValidity(phoneInvalid?'Enter a valid phone number.':'');
    if(phoneInvalid)phone.setAttribute('aria-invalid','true');
    else phone.removeAttribute('aria-invalid');
    for(const [name,label] of [['customer_name','full name'],['shipping_address','complete delivery address'],['shipping_city','city'],['shipping_state','state']]){
      const field=form.elements[name];
      const invalid=!field.value.trim();
      field.setCustomValidity(invalid?`Enter your ${label}.`:'');
      if(invalid)field.setAttribute('aria-invalid','true');
      else field.removeAttribute('aria-invalid');
    }
    if(!form.reportValidity()){
      feedback('Please complete all required delivery details and correct any invalid fields.','error');
      return false;
    }
    feedback('');
    return true;
  }
  function updateCartSnapshots() {
    const byKey=new Map(lines.filter(line=>line.product&&line.variant).map(line=>[line.key,line]));
    cart=cart.map(item=>{const line=byKey.get(cartKey(item));return line?{...item,unitPricePaise:line.pricePaise,availableStock:Number(line.variant.stock)}:item;});
    if(!buyNowMode)window.FormeCommerce?.replaceCart(cart,checkoutUserId);
  }
  async function imageFor(line) {
    const path=line.product?.image_path;
    if(path&&client){try{const {data,error}=await client.storage.from('product-images').createSignedUrl(path,3600);if(!error&&data?.signedUrl)return data.signedUrl;}catch{/* show placeholder below */}}
    if(line.product?.image_url&&/^https?:\/\//i.test(line.product.image_url))return line.product.image_url;
    const catalogProduct=line.catalogProduct;
    return catalogProduct?.imageUrl||imagePlaceholder;
  }
  function render() {
    $('checkout-loading').hidden=true;
    $('checkout-content').hidden=false;
    const list=$('checkout-items');
    list.innerHTML=lines.map(line=>{
      const item=line.cartItem;const qty=Number(item.quantity)||0;
      const invalid=line.problem?`<em>${escapeHtml(line.problem)}</em>`:'';
      const image=line.imageUrl||imagePlaceholder;
      return `<article class="checkout-line"><img src="${escapeHtml(image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${imagePlaceholder}'"><div class="checkout-line-info"><strong>${escapeHtml(line.product?.name||line.catalogProduct?.name||'Unavailable product')}</strong><small>Size ${escapeHtml(item.size||'—')} · ${escapeHtml(line.variant?.color_name||line.catalogProduct?.colorNames?.[line.catalogProduct?.colors?.indexOf(item.color)]||'Selected color')}<br>Qty ${qty} · ${escapeHtml(line.variant?.sku||'')}</small>${invalid}</div><div class="checkout-line-price">${money((line.pricePaise||0)*qty)}<small>${money(line.pricePaise)} each</small></div></article>`;
    }).join('');
    const totals=currentTotals();$('summary-subtotal').textContent=money(totals.subtotal);$('summary-shipping').textContent=money(totals.shipping);$('summary-discount').textContent=money(0);$('summary-total').textContent=money(totals.total);
    const invalid=lines.some(line=>line.problem);
    $('place-order').disabled=invalid||!lines.length||submitting;
    $('place-order').innerHTML='Place order and pay <span aria-hidden="true">↗</span>';
    renderPendingPaymentRetries();
    lines.forEach(async line=>{line.imageUrl=await imageFor(line);if($('checkout-content').hidden)return;const index=lines.indexOf(line);const imageNode=list.children[index]?.querySelector('img');if(imageNode&&line.imageUrl)imageNode.src=line.imageUrl;});
  }
  function renderPendingPaymentRetries(){
    const container=$('checkout-pending-orders');
    const pendingOrders=readPendingPayments();
    container.hidden=!pendingOrders.length;
    container.innerHTML=pendingOrders.map(order=>{
      const items=(Array.isArray(order.items)?order.items:[]).map(item=>`${item.name||'Product'} · ${item.size||'—'} · ${item.color||'—'} × ${Number(item.quantity)||0}`).join(', ');
      return `<div class="pending-payment-retry"><p><strong>Order #${escapeHtml(String(order.orderId).slice(0,8))}</strong> · ${money(order.totalPaise)}</p><p>${escapeHtml(items)}</p><button class="place-order pending-order-retry-button" type="button" data-retry-order-id="${escapeHtml(order.orderId)}"${submitting?' disabled':''}>Retry payment for this order <span aria-hidden="true">↗</span></button></div>`;
    }).join('');
  }
  async function loadFreshLines({compareWith=null,checkSavedPrice=false}={}) {
    if(!client)throw new Error('The shop connection is unavailable. Please try again in a moment.');
    const [productsResult,variantsResult,catalogProducts]=await Promise.all([
      client.from('products').select('*'),
      client.from('product_variants').select('*'),
      window.FORME_CATALOG_READY||Promise.resolve([])
    ]);
    if(productsResult.error||variantsResult.error)throw productsResult.error||variantsResult.error;
    const dbProducts=productsResult.data||[],dbVariants=variantsResult.data||[],catalog=Array.isArray(catalogProducts)?catalogProducts:[];
    const next=cart.map(item=>{
      const quantity=Number(item.quantity);const key=cartKey(item);
      const catalogProduct=catalog.find(product=>[product.id,product.dbId,product.legacyId].some(id=>id!=null&&String(id)===String(item.id)));
      const product=dbProducts.find(row=>[row.id,row.legacy_id,row.legacyId,row.slug].some(id=>id!=null&&String(id)===String(item.id))||Boolean(catalogProduct&&String(row.id)===String(catalogProduct.dbId)));
      const line={cartItem:item,key,product,catalogProduct,variant:null,pricePaise:0,problem:''};
      if(!Number.isInteger(quantity)||quantity<1){line.problem='This quantity is invalid. Remove it from your bag and add it again.';return line;}
      if(!product){line.problem='This product is no longer available. Remove it from your bag.';return line;}
      if(!(product.is_active??product.active??true)){line.problem='This product is no longer available. Remove it from your bag.';return line;}
      line.variant=dbVariants.find(variant=>String(variant.product_id)===String(product.id)&&String(variant.size)===String(item.size)&&String(variant.color_hex).toLowerCase()===String(item.color).toLowerCase());
      if(!line.variant){line.problem='This size or color is no longer available. Review your bag.';return line;}
      line.pricePaise=Math.round(Number(product.price_paise??Number(product.price||0)*100));
      const stock=Number(line.variant.stock);
      if(!Number.isSafeInteger(line.pricePaise)||line.pricePaise<0){line.problem='The current price could not be verified.';return line;}
      if(!Number.isInteger(stock)||stock<0){line.problem='Current stock could not be verified.';return line;}
      if(quantity>stock)line.problem=stock===0?'This option is out of stock. Remove it from your bag.':`Only ${stock} left in stock. Update the quantity in your bag.`;
      if(checkSavedPrice&&Number.isFinite(Number(item.unitPricePaise))&&Number(item.unitPricePaise)!==line.pricePaise)line.changed=true;
      if(checkSavedPrice&&Number.isFinite(Number(item.availableStock))&&Number(item.availableStock)!==stock)line.changed=true;
      if(compareWith){const previous=compareWith.get(key);if(!previous||previous.pricePaise!==line.pricePaise||Number(previous.variant?.stock)!==stock)line.changed=true;}
      return line;
    });
    return next;
  }
  async function refreshAndRender({showPriceChange=false}={}) {
    lines=await loadFreshLines({checkSavedPrice:true});
    updateCartSnapshots();
    await Promise.all(lines.map(async line=>{line.imageUrl=await imageFor(line);}));
    render();
    if(lines.some(line=>line.changed))feedback(showPriceChange?'Your cart changed since you last viewed it. We updated the current prices and stock below. Please review before placing your order.':'Current prices or stock changed. We refreshed your order summary; please review it and submit again.','error');
    else if(lines.some(line=>line.problem))feedback('Please review the highlighted item before placing your order.','error');
    else feedback('');
  }
  function showEmpty(){ $('checkout-loading').hidden=true;$('checkout-content').hidden=true;$('checkout-empty').hidden=false; }
  function restoreConfirmation() {
    let confirmation=confirmationMemory;try{confirmation=JSON.parse(sessionStorage.getItem('forme-checkout-confirmation')||'null')||confirmationMemory;}catch{}
    if(!confirmation)return false;
    $('checkout-loading').hidden=true;$('checkout-content').hidden=true;$('checkout-empty').hidden=true;
    const items=(confirmation.items||[]).map(item=>`<div class="confirmation-item"><span>${escapeHtml(item.name)} · ${escapeHtml(item.size)} · ${escapeHtml(item.color)} × ${Number(item.quantity)||0}</span><strong>${money(item.total)}</strong></div>`).join('');
    const legacyClaimMarkup=confirmation.guestClaimCredential?`<section class="guest-claim-code"><h3>Save your guest order claim code</h3><p>Keep this one-time code somewhere safe. After signing in or creating an account, enter it in My Orders to add this order. It is not recoverable if lost.</p><code id="guest-claim-credential">${escapeHtml(confirmation.guestClaimCredential)}</code><button type="button" id="copy-guest-claim-code">Copy claim code</button><span id="guest-claim-copy-status" role="status" aria-live="polite"></span></section>`:'';
    $('checkout-confirmation').innerHTML=`<span class="confirmation-mark" aria-hidden="true">✓</span><h2>Thank you, ${escapeHtml(confirmation.customerName)}.</h2><p>Your payment has been verified and your order is confirmed.</p><div class="confirmation-order-id">Order ID: ${escapeHtml(confirmation.orderId)}</div><div class="confirmation-items">${items}</div><div class="confirmation-total"><span>Order total</span><strong>${money(confirmation.totalPaise)}</strong></div><div class="confirmation-statuses"><span>ORDER · CONFIRMED</span><span>PAYMENT · PAID</span></div>${legacyClaimMarkup}<div class="confirmation-actions"><a class="button-dark" href="shop.html">Continue shopping <span>↗</span></a><a href="orders.html">View my orders</a></div>`;
    $('copy-guest-claim-code')?.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(confirmation.guestClaimCredential);$('guest-claim-copy-status').textContent='Claim code copied.';}
      catch{$('guest-claim-copy-status').textContent='Clipboard access is unavailable. Select and copy the code above.';}
    });
    $('checkout-confirmation').hidden=false;return true;
  }
  function storeConfirmation(confirmation) {confirmationMemory=confirmation;try { sessionStorage.setItem('forme-checkout-confirmation',JSON.stringify(confirmation)); } catch { /* Keep the confirmation available in this page's memory. */ } }
  function friendlyRpcError(error) {
    const message=String(error?.message||'').toLowerCase();
    if(/cart_changed|price_changed|stock_changed|insufficient_stock/.test(message))return 'A price or stock level changed before your order could be placed. We refreshed your summary; please review it and try again.';
    if(/product_unavailable|variant_unavailable/.test(message))return 'One of the items in your bag is no longer available. We refreshed your order summary.';
    if(/cart_invalid|customer_details_invalid/.test(message))return 'Please check your details and the items in your bag, then try again.';
    return 'We couldn’t place the order just now. Your bag is still saved. Please try again.';
  }
  function isDevelopmentHost() {
    const hostname=window.location.hostname.toLowerCase();
    return window.location.protocol==='file:'
      ||hostname==='localhost'
      ||hostname==='127.0.0.1'
      ||hostname==='::1'
      ||hostname.endsWith('.local');
  }
  function diagnosticText(value) {
    let text=String(value??'').slice(0,1000);
    for(const name of ['customer_name','customer_email','customer_phone','shipping_address','shipping_city','shipping_state','shipping_pincode']){
      const field=$('checkout-form').elements.namedItem(name);
      const privateValue=field?.value?.trim();
      if(privateValue&&privateValue.length>=3)text=text.replaceAll(privateValue,'[redacted]');
    }
    return text
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[redacted-email]')
      .replace(/\bBearer\s+\S+/gi,'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted-token]')
      .replace(/\b(?:razorpay_signature|access_token|refresh_token|service_role|secret_key)\s*[:=]\s*\S+/gi,'[redacted-sensitive-value]');
  }
  function logCheckoutDiagnostic(operation,error,authenticated) {
    if(!isDevelopmentHost())return;
    console.error('VC Fashion checkout operation failed.',{
      operation,
      authenticated,
      status:error?.status??null,
      code:error?.code??null,
      message:diagnosticText(error?.message),
      details:diagnosticText(error?.details),
      hint:diagnosticText(error?.hint)
    });
  }

  async function functionFailure(error){
    const context=error?.context;
    let payload=null;
    try{
      if(context&&typeof context.json==='function')payload=await context.json();
    }catch{/* Fall back to the message the client reported. */}
    const failure=new Error(payload?.error||error?.message||'Could not start secure payment.');
    failure.status=typeof context?.status==='number'?context.status:(typeof error?.status==='number'?error.status:null);
    failure.payload=payload;
    return failure;
  }
  function reportsPaidOrder(error){
    return /already paid|not payable/i.test(`${error?.payload?.error||''} ${error?.message||''}`);
  }
  // Removes only the units a confirmed order purchased from the live bag.
  // Buy Now payments never touch the stored cart, and a mismatched account
  // never clears another account's bag.
  function removePurchasedFromCart(pending){
    if(!pending||buyNowMode||pending.buyNowMode)return {updated:false,removed:0,reason:'buy-now'};
    if(!Array.isArray(pending.cartItems)||!pending.cartItems.length)return {updated:false,removed:0,reason:'nothing'};
    const removal=window.FormeCommerce?.removePurchasedLines(pending.cartItems,checkoutUserId);
    if(!removal)return {updated:false,removed:0,reason:'unavailable'};
    if(!removal.updated&&removal.reason==='identity'){
      console.warn('VC Fashion paid items were left in the bag because the active account does not match this order.',{orderId:pending.orderId});
      return removal;
    }
    if(removal.updated){
      cart=readCart();
      lines=lines.filter(line=>cart.some(item=>item.cartItemId===line.cartItem.cartItemId)).map(line=>{
        const left=cart.find(item=>item.cartItemId===line.cartItem.cartItemId);
        return left?{...line,cartItem:{...line.cartItem,quantity:left.quantity}}:line;
      });
    }
    return removal;
  }
  // Drops retry entries whose order the server already settled, removing only
  // the purchased units for orders that are confirmed paid.
  async function reconcilePendingPayments(){
    const pending=readPendingPayments();
    if(!pending.length||!client)return {cleared:0,paidCleared:0};
    const ids=[...new Set(pending.map(entry=>entry.orderId))];
    let rows=[];
    try{
      const {data,error}=await client.from('orders').select('id,payment_status,order_status').in('id',ids);
      if(error)throw error;
      rows=Array.isArray(data)?data:[];
    }catch(error){
      console.warn('VC Fashion pending payments could not be checked against their order status.',error);
      return {cleared:0,paidCleared:0};
    }
    const byId=new Map(rows.map(row=>[String(row.id),row]));
    let cleared=0,paidCleared=0;
    for(const entry of pending){
      const order=byId.get(entry.orderId);
      if(!order)continue;
      const payment=String(order.payment_status||'').toLowerCase();
      const status=String(order.order_status||'').toLowerCase();
      const paid=payment==='paid';
      const settled=payment==='refunded'||(status==='cancelled'&&payment!=='pending');
      if(!paid&&!settled)continue;
      if(paid){
        const removal=removePurchasedFromCart(entry);
        if(!removal.updated&&removal.reason==='identity')continue;
        paidCleared+=1;
      }
      clearPendingPayment(entry.orderId);
      cleared+=1;
    }
    if(cleared)renderPendingPaymentRetries();
    return {cleared,paidCleared};
  }
  async function startPayment(pending){
    if(!window.Razorpay)throw new Error('Secure checkout did not load. Refresh this page and retry payment.');
    feedback('Preparing secure payment…');
    const {data:paymentOrder,error}=await client.functions.invoke('create-razorpay-order',{body:{order_id:pending.orderId,guest_payment_token:pending.guestToken||null}});
    if(error)throw await functionFailure(error);
    if(!paymentOrder?.razorpay_order_id||!paymentOrder?.key_id)throw new Error(paymentOrder?.error||'The payment session could not be created.');
    const options={key:paymentOrder.key_id,amount:paymentOrder.amount,currency:paymentOrder.currency,order_id:paymentOrder.razorpay_order_id,name:'VC Fashion',description:`VC Fashion order ${String(pending.orderId).slice(0,8)}`,prefill:{name:pending.customerName,email:pending.customerEmail,contact:pending.customerPhone},theme:{color:'#22231f'},
      handler:async response=>{
        try{
          feedback('Verifying your payment securely…');
          const {data:verified,error:verifyError}=await client.functions.invoke('verify-razorpay-payment',{body:{order_id:pending.orderId,guest_payment_token:pending.guestToken||null,...response}});
          if(verifyError||!verified?.verified||verified.payment_status!=='paid')throw new Error(verified?.error||verifyError?.message||'Payment verification is still pending.');
          const verifiedTotal=Number(verified.total_paise);
          if(!Number.isSafeInteger(verifiedTotal)||verifiedTotal<=0)throw new Error('The verified order total is unavailable.');
          if(pending.buyNowMode&&buyNowMode)sessionStorage.removeItem(buyNowIntentKey);
          removePurchasedFromCart(pending);
          clearPendingPayment(pending.orderId);
          renderPendingPaymentRetries();
          if(verified.recovery_required){feedback(`Payment received for order ${pending.orderId}, but the order was cancelled before confirmation. Do not pay again; contact VC Fashion support for recovery or refund assistance.`,'error');return;}
          const confirmation={orderId:pending.orderId,customerName:pending.customerName,totalPaise:verifiedTotal,items:pending.items,guestClaimCredential:pending.guestClaimCredential||null};
          storeConfirmation(confirmation);showConfirmationFrom(confirmation);
        }catch(error){console.error('VC Fashion payment verification failed.',error);feedback('We could not verify the payment yet. Your order remains pending; retry or contact support if your bank shows a debit.','error');}
        finally{submitting=false;render();}
      },
      modal:{ondismiss:()=>{submitting=false;feedback('Payment was not completed. Your order remains pending; you can retry payment here.','error');render();}}
    };
    const razorpay=new window.Razorpay(options);
    razorpay.on('payment.failed',()=>{feedback('Payment was not completed. Your order remains pending; close this payment window to retry it.','error');});
    razorpay.open();
    return true;
  }
  async function retryPendingPayment(pending){
    if(submitting)return;
    submitting=true;renderPendingPaymentRetries();
    try{
      const {data:userData,error:userError}=await client.auth.getUser();
      if(userError)throw userError;
      if(userData?.user?.id!==checkoutUserId)throw new Error('Your account changed while checkout was open. Sign in to the account that placed this order and try again.');
      await startPayment(pending);
    }catch(error){
      submitting=false;console.error('VC Fashion pending payment could not be retried.',error);
      if(reportsPaidOrder(error)){
        const message=`${error?.payload?.error||''} ${error?.message||''}`;
        if(/already paid/i.test(message)){
          // The server is authoritative here: this order is settled, so the
          // retry entry and its purchased units must not survive.
          removePurchasedFromCart(pending);
          clearPendingPayment(pending.orderId);
          renderPendingPaymentRetries();
          feedback('This order was already paid. We removed it from the retry list and took those items out of your bag.','success');
          return;
        }
        await reconcilePendingPayments();
        renderPendingPaymentRetries();
        const stillPending=readPendingPayments().some(entry=>entry.orderId===pending.orderId);
        feedback(stillPending
          ?'This order can no longer be paid here. Open My Orders to see its current status.'
          :'This order can no longer be paid, so we removed it from the retry list.',stillPending?'error':'success');
        return;
      }
      feedback('This order could not be retried. Its payment status was not changed; refresh your orders and try again.','error');
      renderPendingPaymentRetries();
    }
  }
  async function placeOrder(event) {
    event.preventDefault();if(submitting)return;
    if(!client){feedback('Secure checkout is unavailable. Please try again later.','error');return;}
    submitting=true;$('place-order').disabled=true;
    let paymentOpened=false;
    let operation='verify-checkout-session';
    let authenticated=false;
    try {
      const {data:userData,error:userError}=await client.auth.getUser();
      if(userError){
        if(isExpiredSessionError(userError)){redirectToLogin();return;}
        throw userError;
      }
      const authenticatedUser=userData?.user;
      if(!authenticatedUser?.id){redirectToLogin();return;}
      authenticated=true;
      if(authenticatedUser.id!==checkoutUserId)throw new Error('Your account changed while checkout was open. Review the current bag and try again.');
      const form=$('checkout-form');
      if(!validateDeliveryDetails())return;
      const phone=form.elements.customer_phone.value.trim();
      if(!cart.length){showEmpty();return;}
      $('place-order').innerHTML='Checking availability…';feedback('Checking current price and stock…');
      operation='load-current-products-and-stock';
      const latest=await loadFreshLines({compareWith:new Map(lines.map(line=>[line.key,line]))});
      const cartNow=readCart();
      const cartChanged=!buyNowMode&&JSON.stringify(cartNow.map(item=>[item.id,item.size,item.color,item.quantity]).sort())!==JSON.stringify(cart.map(item=>[item.id,item.size,item.color,item.quantity]).sort());
      const changed=latest.some(line=>line.changed)||cartChanged;
      if(changed||latest.some(line=>line.problem)){
        cart=cartNow;lines=latest;updateCartSnapshots();await Promise.all(lines.map(async line=>{line.imageUrl=await imageFor(line);}));render();feedback(changed?'Your bag, price, or available stock changed. We refreshed the summary; please review it and place your order again.':'An item is no longer available in the requested quantity. Review the updated summary before continuing.','error');return;
      }
      const values=new FormData(form);const customerName=String(values.get('customer_name')).trim();
      operation='verify-session-before-order-rpc';
      const {data:confirmedUserData,error:confirmedUserError}=await client.auth.getUser();
      if(confirmedUserError)throw confirmedUserError;
      if(confirmedUserData?.user?.id!==authenticatedUser.id)throw new Error('Your account changed while checkout was open. Review the current bag and try again.');
      operation='create_checkout_order';
      const {data,error}=await client.rpc('create_checkout_order',{
        p_customer_name:customerName,
        p_customer_email:String(values.get('customer_email')).trim(),
        p_customer_phone:phone,
        p_shipping_address:String(values.get('shipping_address')).trim(),
        p_shipping_city:String(values.get('shipping_city')).trim(),
        p_shipping_state:String(values.get('shipping_state')).trim(),
        p_shipping_pincode:String(values.get('shipping_pincode')).trim(),
        p_items:latest.map(line=>({product_id:String(line.product.id),variant_id:String(line.variant.id),quantity:Number(line.cartItem.quantity),expected_unit_price_paise:line.pricePaise,expected_stock:Number(line.variant.stock)})),
        p_guest_payment_token_hash:null
      });
      if(error)throw error;
      operation='validate-order-rpc-response';
      const result=typeof data==='string'?JSON.parse(data):data;
      if(!result?.order_id)throw new Error('The order response was incomplete.');
      const totals=currentTotals();
      const orderSubtotal=Number(result.subtotal_paise??totals.subtotal),orderShipping=Number(result.shipping_paise??totals.shipping),orderDiscount=Number(result.discount_paise??totals.discount),orderTotal=Number(result.total_paise??totals.total);
      $('summary-subtotal').textContent=money(orderSubtotal);$('summary-shipping').textContent=money(orderShipping);$('summary-discount').textContent=money(orderDiscount);$('summary-total').textContent=money(orderTotal);
      const pending={orderId:result.order_id,userId:authenticatedUser.id,customerName,customerEmail:String(values.get('customer_email')).trim(),customerPhone:phone,totalPaise:orderTotal,items:latest.map(line=>({name:line.product.name,size:line.variant.size,color:line.variant.color_name,quantity:Number(line.cartItem.quantity),total:line.pricePaise*Number(line.cartItem.quantity)})),cartItems:latest.map(line=>({id:String(line.cartItem.id),cartItemId:typeof line.cartItem.cartItemId==='string'?line.cartItem.cartItemId:null,size:String(line.cartItem.size),color:String(line.cartItem.color),quantity:Number(line.cartItem.quantity)})),buyNowMode};
      storePendingPayment(pending);
      renderPendingPaymentRetries();
      operation='create-razorpay-order';
      paymentOpened=await startPayment(pending);
    } catch(error) {
      logCheckoutDiagnostic(operation,error,authenticated);
      if(isExpiredSessionError(error)){
        redirectToLogin();
        return;
      }
      if(/cart_changed|price_changed|stock_changed|insufficient_stock|product_unavailable|variant_unavailable/i.test(String(error?.message||''))){try{lines=await loadFreshLines();updateCartSnapshots();await Promise.all(lines.map(async line=>{line.imageUrl=await imageFor(line);}));render();}catch{/* retain the currently visible checkout */}}
      feedback(operation==='create-razorpay-order'?'Your order was created, but payment could not start. Use its order-specific Retry payment button to try again.':friendlyRpcError(error),'error');
    } finally {if(!paymentOpened)submitting=false;if($('checkout-content').hidden===false)render();}
  }
  function showConfirmationFrom(confirmation) {
    storeConfirmation(confirmation);
    restoreConfirmation();feedback('Payment verified. Your order is confirmed.','success');
  }
  async function init() {
    restoreCheckoutDetails();
    if(buyNowError){$('checkout-loading').hidden=true;feedback('The selected item could not be verified. Return to the product page and try Buy Now again.','error');return;}
    const reconciled=await reconcilePendingPayments();
    renderPendingPaymentRetries();
    if(restoreConfirmation()&&!cart.length&&!readPendingPayments().length)return;
    $('checkout-confirmation').hidden=true;
    if(!cart.length&&!readPendingPayments().length){
      if(reconciled.paidCleared)feedback('Your earlier payment was already confirmed, so those items were removed from your bag.','success');
      showEmpty();return;
    }
    try{await refreshAndRender({showPriceChange:true});}
    catch(error){console.error('VC Fashion checkout data could not be loaded.',error);$('checkout-loading').hidden=true;feedback('We couldn’t verify your bag with the shop right now. Please refresh this page or try again shortly.','error');}
    $('checkout-form').addEventListener('submit',placeOrder);
    if(readPendingPayments().length)feedback('You have one or more orders awaiting payment. Choose a specific order below to retry, or place a new order from your current bag.');
    else if(reconciled.paidCleared)feedback('Your earlier payment was already confirmed, so those items were removed from your bag.','success');
  }
  $('checkout-pending-orders').addEventListener('click',event=>{
    const button=event.target.closest('[data-retry-order-id]');
    if(!button)return;
    const pending=readPendingPayments().find(order=>order.orderId===button.dataset.retryOrderId);
    if(pending)retryPendingPayment(pending);
  });
  (window.FORME_COMMERCE_READY||Promise.resolve()).then(()=>{
    checkoutUserId=window.FormeCommerce?.getUserId()??null;
    if(!buyNowMode)cart=readCart();
    init();
    window.addEventListener('forme:account-data-changed',async()=>{
      if(buyNowMode)return;
      const nextUserId=window.FormeCommerce?.getUserId()??null;
      if(nextUserId===checkoutUserId)return;
      checkoutUserId=nextUserId;
      cart=readCart();
      lines=[];
      renderPendingPaymentRetries();
      $('checkout-content').hidden=true;
      $('checkout-empty').hidden=true;
      $('checkout-loading').hidden=false;
      feedback('');
      if(!cart.length&&!readPendingPayments().length){showEmpty();return;}
      try{await refreshAndRender();}
      catch(error){console.error('VC Fashion checkout could not refresh the active account bag.',error);$('checkout-loading').hidden=true;feedback('We couldn’t verify the current account bag. Please refresh this page or try again shortly.','error');}
    });
  }).catch(error=>{
    console.error('VC Fashion checkout could not verify the current account.',error);
    $('checkout-loading').hidden=true;
    feedback('We couldn’t verify your account bag. Please refresh this page or try again shortly.','error');
  });
})();
