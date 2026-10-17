// Shared cart and wishlist state for the shop and product detail pages.
(() => {
  let products = window.FORME_PRODUCTS;
  const money = value => `₹${Number(value).toLocaleString('en-IN')}`;
  const imageUrl = (id, width=800) => /^https?:\/\//i.test(id || '') ? id : `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=78`;
  const productImageUrl = (product, width=800) => product.imageUrl || imageUrl(product.image, width);
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const readStored = key => {
    const raw=localStorage.getItem(key);
    if(raw===null)return {present:false,value:null};
    try{return {present:true,raw,value:JSON.parse(raw)};}catch(error){return {present:true,raw,error};}
  };
  const storageKey = (key,userId) => userId ? `${key}:user:${userId}` : key;
  let cart = [];
  let wishlist = new Set();
  let activeUserId = null;
  let accountDataReady = false;
  let accountLoadPromise = null;
  let accountLoadUserId = null;
  let accountLoadVersion = 0;
  let toastTimer;
  let lastCartTrigger = null;

  function newCartItemId(){return globalThis.crypto?.randomUUID?.()||`cart-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
  function persistCart(){if(accountDataReady)localStorage.setItem(storageKey('forme-cart',activeUserId),JSON.stringify(cart));}
  function persistWishlist(){if(accountDataReady)localStorage.setItem(storageKey('forme-wishlist',activeUserId),JSON.stringify([...wishlist]));}
  function normalizeCart(items){
    if(!Array.isArray(items))return [];
    const normalized=[];
    items.forEach(item=>{
      if(!item||typeof item.id!=='string'||!item.id)return;
      const product=products.find(entry=>entry.id===item.id);
      const size=typeof item.size==='string'&&item.size?item.size:(product?.defaultSize||'M');
      const color=typeof item.color==='string'&&item.color?item.color:(product?.defaultColor||product?.colors?.[0]||'');
      const quantity=Number(item.quantity);
      if(!Number.isSafeInteger(quantity)||quantity<1)return;
      const existing=normalized.find(entry=>entry.id===item.id&&entry.size===size&&entry.color===color);
      const cartItemId=typeof item.cartItemId==='string'&&item.cartItemId?item.cartItemId:newCartItemId();
      if(existing){
        const sum=existing.quantity+quantity;
        if(Number.isSafeInteger(sum))existing.quantity=sum;
      }else normalized.push({...item,id:item.id,size,color,quantity,cartItemId});
    });
    return normalized;
  }
  function readCartFor(key){
    const stored=readStored(key);
    if(stored.error)throw stored.error;
    return normalizeCart(stored.value);
  }
  function readWishlistFor(key){
    const stored=readStored(key);
    if(stored.error)throw stored.error;
    return [...new Set(Array.isArray(stored.value)?stored.value.filter(id=>typeof id==='string'&&id):[])];
  }
  function resolveCatalogItem(item){
    if(!item||typeof item.id!=='string'||!item.id)return {error:'invalid'};
    const matches=products.filter(product=>
      [product.id,product.dbId,product.legacyId,product.slug]
        .some(id=>id!=null&&String(id)===String(item.id))
    );
    if(matches.length!==1)return {error:matches.length?'ambiguous':'product'};
    const product=matches[0];
    if(product.source!=='supabase'||!product.dbId)return {error:'catalog'};
    const variant=product.variants?.find(entry=>
      String(entry.size)===String(item.size)
      &&String(entry.color_hex).toLowerCase()===String(item.color).toLowerCase()
    );
    if(!variant||!variant.id)return {error:'variant'};
    if(variant.stock===null||variant.stock===undefined||variant.stock==='')return {error:'stock'};
    const stock=Number(variant.stock),quantity=Number(item.quantity);
    if(!Number.isInteger(stock)||stock<0)return {error:'stock'};
    if(!Number.isSafeInteger(quantity)||quantity<1)return {error:'quantity'};
    if(product.price===null||product.price===undefined||product.price==='')return {error:'price'};
    const normalized={
      ...item,
      id:product.id,
      size:String(item.size),
      color:String(item.color),
      quantity,
      unitPricePaise:Math.round(Number(product.price)*100),
      availableStock:stock
    };
    if(!Number.isSafeInteger(normalized.unitPricePaise)||normalized.unitPricePaise<0)return {error:'price'};
    return {product,variant,stock,item:normalized};
  }
  function migrationCartKey(item){return `${item.id}|${item.size}|${item.color}`;}
  function migrateGuestData(userId){
    const guestCartKey='forme-cart',guestWishlistKey='forme-wishlist';
    const accountCartKey=storageKey(guestCartKey,userId),accountWishlistKey=storageKey(guestWishlistKey,userId);
    const journalKey=`forme-commerce-migration:user:${userId}`;
    const pending=readStored(journalKey);
    if(pending.error)throw pending.error;
    if(pending.value){
      const guestCart=readStored(guestCartKey),guestWishlist=readStored(guestWishlistKey);
      const hasGuestData=guestCart.present||guestWishlist.present;
      const unchanged=(!guestCart.present||guestCart.raw===pending.value.guestCartRaw)
        &&(!guestWishlist.present||guestWishlist.raw===pending.value.guestWishlistRaw);
      if(hasGuestData&&unchanged&&pending.value.version===2&&Array.isArray(pending.value.guestCartRemaining)){
        localStorage.setItem(accountCartKey,JSON.stringify(pending.value.cart));
        localStorage.setItem(accountWishlistKey,JSON.stringify(pending.value.wishlist));
        if(pending.value.guestCartRemaining?.length)localStorage.setItem(guestCartKey,JSON.stringify(pending.value.guestCartRemaining));
        else localStorage.removeItem(guestCartKey);
        localStorage.removeItem(guestWishlistKey);
        localStorage.removeItem(journalKey);
        return {issues:Number(pending.value.issues)||0};
      }else if(hasGuestData){
        localStorage.removeItem(journalKey);
        return migrateGuestData(userId);
      }
      localStorage.removeItem(journalKey);
      return {issues:0};
    }
    const guestCart=readStored(guestCartKey),guestWishlist=readStored(guestWishlistKey);
    if(guestCart.error)throw guestCart.error;
    if(guestWishlist.error)throw guestWishlist.error;
    if(!guestCart.present&&!guestWishlist.present)return {issues:0};
    const accountCart=readStored(accountCartKey),accountWishlist=readStored(accountWishlistKey);
    if(accountCart.error)throw accountCart.error;
    if(accountWishlist.error)throw accountWishlist.error;
    if(guestCart.present&&!Array.isArray(guestCart.value))throw new Error('Saved guest cart is not a valid list.');
    const cartItems=Array.isArray(accountCart.value)?accountCart.value:[];
    const guestItems=Array.isArray(guestCart.value)?guestCart.value:[];
    const mergedCart=[],remainingGuest=[],issues={};
    const issue=(reason)=>{issues[reason]=(issues[reason]||0)+1;};

    cartItems.forEach(item=>{
      const resolved=resolveCatalogItem(item);
      if(resolved.error){mergedCart.push(item);return;}
      mergedCart.push(resolved.item);
    });

    for(const item of guestItems){
      const resolved=resolveCatalogItem(item);
      if(resolved.error){remainingGuest.push(item);issue(resolved.error);continue;}
      const key=migrationCartKey(resolved.item);
      const matching=mergedCart
        .map((entry,index)=>({entry,index}))
        .filter(({entry})=>entry&&migrationCartKey(entry)===key&&Number.isSafeInteger(Number(entry.quantity))&&Number(entry.quantity)>0);
      const currentQuantity=matching.reduce((sum,{entry})=>sum+Number(entry.quantity),0);
      if(!Number.isSafeInteger(currentQuantity)){remainingGuest.push(resolved.item);issue('quantity');continue;}
      const available=Math.max(0,resolved.stock-currentQuantity);
      const moved=Math.min(available,resolved.item.quantity);
      if(matching.length>1&&currentQuantity<=resolved.stock){
        const first=matching[0];
        mergedCart[first.index]={...resolved.item,quantity:currentQuantity};
        matching.slice(1).reverse().forEach(({index})=>mergedCart.splice(index,1));
      }
      if(moved>0){
        if(matching.length) {
          const target=mergedCart.findIndex(entry=>entry&&migrationCartKey(entry)===key);
          if(target>=0)mergedCart[target]={...resolved.item,quantity:currentQuantity+moved};
        } else mergedCart.push({...resolved.item,quantity:moved});
      }
      if(moved<resolved.item.quantity){
        remainingGuest.push({...resolved.item,quantity:resolved.item.quantity-moved});
        issue('stock_limit');
      }
    }

    const merged={
      cart:mergedCart,
      guestCartRemaining:remainingGuest,
      wishlist:[...new Set([
        ...(Array.isArray(accountWishlist.value)?accountWishlist.value.filter(id=>typeof id==='string'&&id):[]),
        ...(Array.isArray(guestWishlist.value)?guestWishlist.value.filter(id=>typeof id==='string'&&id):[])
      ])],
      guestCartRaw:guestCart.raw??null,
      guestWishlistRaw:guestWishlist.raw??null,
      version:2,
      issues:Object.values(issues).reduce((sum,count)=>sum+count,0)
    };
    localStorage.setItem(journalKey,JSON.stringify(merged));
    localStorage.setItem(accountCartKey,JSON.stringify(merged.cart));
    localStorage.setItem(accountWishlistKey,JSON.stringify(merged.wishlist));
    if(merged.guestCartRemaining.length)localStorage.setItem(guestCartKey,JSON.stringify(merged.guestCartRemaining));
    else localStorage.removeItem(guestCartKey);
    localStorage.removeItem(guestWishlistKey);
    localStorage.removeItem(journalKey);
    return {issues:merged.issues};
  }
  function loadAccountData(userId){
    if(accountDataReady&&activeUserId===userId)return Promise.resolve();
    if(accountLoadPromise&&accountLoadUserId===userId)return accountLoadPromise;
    const version=++accountLoadVersion;
    accountDataReady=false;
    accountLoadUserId=userId;
    accountLoadPromise=(async()=>{
      let migrationIssues=0;
      try{
        const loadedProducts=await (window.FORME_CATALOG_READY||Promise.resolve(products));
        if(version!==accountLoadVersion)return;
        if(Array.isArray(loadedProducts)&&loadedProducts.length)products=loadedProducts;
        if(userId&&!activeUserId){
          try{
            const result=migrateGuestData(userId);
            migrationIssues=result?.issues||0;
          }catch(error){
            console.error('VC Fashion guest cart and wishlist could not be migrated; guest data was retained.',error);
            migrationIssues=1;
          }
        }
        if(version!==accountLoadVersion)return;
        activeUserId=userId;
        try{
          cart=readCartFor(storageKey('forme-cart',userId));
          wishlist=new Set(readWishlistFor(storageKey('forme-wishlist',userId)));
        }catch(error){
          console.error('VC Fashion cart and wishlist could not be loaded from local storage.',error);
          cart=[];
          wishlist=new Set();
        }
        accountDataReady=true;
        persistCart();
        renderCart();
        if(migrationIssues)toast('Some saved bag items could not be moved or exceeded available stock. They remain saved in the guest bag; sign out to review them.',6000);
        window.dispatchEvent(new CustomEvent('forme:account-data-changed'));
        window.dispatchEvent(new CustomEvent('forme:wishlist'));
      }catch(error){
        if(version!==accountLoadVersion)return;
        console.error('VC Fashion cart and wishlist account could not be verified.',error);
        activeUserId=userId;
        cart=[];
        wishlist=new Set();
        accountDataReady=true;
        renderCart();
        window.dispatchEvent(new CustomEvent('forme:account-data-changed'));
      }
    })().finally(()=>{
      if(version===accountLoadVersion){
        accountLoadPromise=null;
        accountLoadUserId=null;
      }
    });
    return accountLoadPromise;
  }
  function toast(message,duration=2100){const box=document.getElementById('toast');if(!box)return;box.textContent=message;box.classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('is-visible'),duration);}
  function renderCart(){
    const count=cart.reduce((sum,item)=>sum+item.quantity,0);
    const subtotal=cart.reduce((sum,item)=>sum+(products.find(product=>product.id===item.id)?.price||0)*item.quantity,0);
    const countNode=document.getElementById('cart-count');if(countNode)countNode.textContent=count;
    const mobileCount=document.getElementById('mobile-cart-count');if(mobileCount)mobileCount.textContent=count;
    const drawerCount=document.getElementById('drawer-count');if(drawerCount)drawerCount.textContent=`(${count})`;
    const subtotalNode=document.getElementById('cart-subtotal');if(subtotalNode)subtotalNode.textContent=money(subtotal);
    const empty=document.getElementById('cart-empty');if(empty)empty.hidden=cart.length>0;
    const summary=document.getElementById('cart-summary');if(summary)summary.hidden=cart.length===0;
    const container=document.getElementById('cart-items');if(!container)return;
    const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    container.innerHTML=cart.map(item=>{
      const product=products.find(entry=>entry.id===item.id);
      const key=encodeURIComponent(`${item.id}|${item.size}|${item.color}`);
      if(!product)return `<div class="cart-item"><div><p class="cart-item-name">Saved item unavailable</p><span class="cart-item-meta">This saved product could not be matched to the current collection.</span><p class="cart-item-price">Quantity ${Number(item.quantity)||0}</p></div><button class="remove-item" type="button" data-cart-remove="${key}">Remove</button></div>`;
      const safeName=product.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      return `<div class="cart-item"><img src="${productImageUrl(product,240)}" alt="${safeName}" loading="lazy"><div><p class="cart-item-name">${safeName}</p><span class="cart-item-meta">Size ${escapeHtml(item.size)} · ${escapeHtml(product.colorNames[product.colors.indexOf(item.color)]||'Selected colour')}</span><p class="cart-item-price">${money(product.price)}</p><div class="quantity-control"><button type="button" data-cart-change="-1" data-cart-key="${key}" aria-label="Decrease ${safeName} quantity">−</button><span>${Number(item.quantity)||0}</span><button type="button" data-cart-change="1" data-cart-key="${key}" aria-label="Increase ${safeName} quantity">+</button></div></div><button class="remove-item" type="button" data-cart-remove="${key}">Remove</button></div>`;
    }).join('');
  }
  function setDrawer(open){
    const drawer=document.getElementById('cart-drawer'),backdrop=document.getElementById('drawer-backdrop');if(!drawer||!backdrop)return;
    drawer.classList.toggle('is-open',open);drawer.setAttribute('aria-hidden',String(!open));backdrop.hidden=!open;
    requestAnimationFrame(()=>backdrop.classList.toggle('is-visible',open));document.body.classList.toggle('drawer-open',open);
    if(open)document.getElementById('cart-close')?.focus();else (lastCartTrigger?.isConnected?lastCartTrigger:document.getElementById('cart-trigger'))?.focus();
  }
  function add(productId,size='M',color){
    if(!accountDataReady)return;
    const product=products.find(entry=>entry.id===productId);if(!product)return;
    const selectedColor=color||product.defaultColor||product.colors[0];let item=cart.find(entry=>entry.id===productId&&entry.size===size&&entry.color===selectedColor);
    const variant=(product.variants||[]).find(entry=>entry.size===size&&entry.color_hex===selectedColor);
    if(product.source==='supabase'&&(!variant||!Number.isInteger(Number(variant.stock))||Number(variant.stock)<=0||(item&&item.quantity>=Number(variant.stock)))){toast('This size and colour are out of stock');return;}
    if(item){item.quantity+=1;item.unitPricePaise??=Math.round(Number(product.price)*100);item.availableStock??=product.source==='supabase'?Number(variant.stock):null;}else cart.push({id:productId,size,color:selectedColor,quantity:1,cartItemId:newCartItemId(),unitPricePaise:Math.round(Number(product.price)*100),availableStock:product.source==='supabase'?Number(variant.stock):null});
    persistCart();renderCart();toast(`${product.name} added to your bag`);
  }
  function toggleWishlist(id){
    if(!accountDataReady)return;
    if(wishlist.has(id)){wishlist.delete(id);toast('Removed from your saved pieces');}
    else{wishlist.add(id);toast('Saved to your favourites');}
    persistWishlist();window.dispatchEvent(new CustomEvent('forme:wishlist'));
  }
  function changeQuantity(key,delta){
    if(!accountDataReady)return;
    let decoded;try{decoded=decodeURIComponent(key);}catch{return;}
    const [id,size,color]=decoded.split('|');const item=cart.find(entry=>entry.id===id&&entry.size===size&&entry.color===color);
    const product=products.find(entry=>entry.id===id);
    const variant=product?.variants?.find(entry=>entry.size===size&&entry.color_hex===color);
    if(delta>0&&product?.source==='supabase'&&(!variant||!Number.isInteger(Number(variant.stock))||Number(variant.stock)<=0||!item||item.quantity+delta>Number(variant.stock))){toast('No more stock is available for this option');return;}
    if(item)item.quantity+=delta;cart=cart.filter(entry=>entry.quantity>0);persistCart();renderCart();
  }
  document.addEventListener('click',event=>{
    if(!accountDataReady)return;
    const target=event.target;
    const addButton=target.closest('[data-add-cart]');if(addButton){add(addButton.dataset.addCart,addButton.dataset.size||'M',addButton.dataset.color);}
    const wishButton=target.closest('[data-wishlist]');if(wishButton)toggleWishlist(wishButton.dataset.wishlist);
    const changeButton=target.closest('[data-cart-change]');if(changeButton)changeQuantity(changeButton.dataset.cartKey,Number(changeButton.dataset.cartChange));
    const removeButton=target.closest('[data-cart-remove]');if(removeButton){let key;try{key=decodeURIComponent(removeButton.dataset.cartRemove);}catch{return;}const [id,size,color]=key.split('|');cart=cart.filter(item=>!(item.id===id&&item.size===size&&item.color===color));persistCart();renderCart();}
    const cartTrigger=target.closest('#cart-trigger,.mobile-cart-trigger');if(cartTrigger){lastCartTrigger=cartTrigger;setDrawer(true);}
    if(target.closest('#cart-close,[data-cart-back]')||target.closest('#drawer-backdrop')||target.closest('#continue-shopping'))setDrawer(false);
    if(target.closest('#checkout-button'))window.location.href='checkout.html';
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.getElementById('cart-drawer')?.classList.contains('is-open'))setDrawer(false);});
  // Removes only the units a confirmed order actually purchased, preserving
  // unrelated lines and any extra quantity added after checkout started.
  function removePurchasedLines(purchased,userId){
    if(!Array.isArray(purchased)||!purchased.length)return {updated:false,removed:0,reason:'nothing'};
    // Never touch a bag that does not belong to the caller.
    if(!accountDataReady||activeUserId!==userId)return {updated:false,removed:0,reason:'identity'};
    const working=cart.map(item=>({...item}));
    let removed=0;
    const takeFrom=(matches,wanted)=>{
      working.forEach(item=>{
        if(wanted.value<1||!item)return;
        if(!matches(item))return;
        const held=Number(item.quantity);
        if(!Number.isSafeInteger(held)||held<1)return;
        const taken=Math.min(held,wanted.value);
        wanted.value-=taken;removed+=taken;
        item.quantity=held-taken;
      });
    };
    purchased.forEach(line=>{
      if(!line)return;
      const ordered=Number(line.quantity);
      if(!Number.isSafeInteger(ordered)||ordered<1)return;
      const wanted={value:ordered};
      // Stable cart line identity survives catalog id remapping.
      const cartItemId=typeof line.cartItemId==='string'&&line.cartItemId?line.cartItemId:null;
      if(cartItemId)takeFrom(item=>String(item.cartItemId)===cartItemId,wanted);
      if(wanted.value>0&&typeof line.id==='string'&&line.id){
        takeFrom(item=>String(item.id)===String(line.id)
          &&(typeof line.size!=='string'||String(item.size)===String(line.size))
          &&(typeof line.color!=='string'||String(item.color||'').toLowerCase()===String(line.color).toLowerCase()),wanted);
      }
    });
    if(removed<1)return {updated:false,removed:0,reason:'no-match'};
    cart=working.filter(item=>item&&Number(item.quantity)>0);
    persistCart();
    renderCart();
    return {updated:true,removed,remaining:cart.length};
  }
  window.FormeCommerce={
    money,imageUrl,add,renderCart,removePurchasedLines,isWishlisted:id=>wishlist.has(id),
    getUserId:()=>accountDataReady?activeUserId:null,
    getCart:userId=>accountDataReady&&activeUserId===userId?cart.map(item=>({...item})):[],
    replaceCart:(items,userId)=>{if(!accountDataReady||activeUserId!==userId||!Array.isArray(items))return;cart=items.map(item=>({...item}));persistCart();renderCart();},
    clearCart:userId=>{if(!accountDataReady||activeUserId!==userId)return;cart=[];persistCart();renderCart();}
  };
  window.FORME_COMMERCE_READY=new Promise((resolve,reject)=>{
    const client=window.FORME_SUPABASE;
    if(!client){
      loadAccountData(null).then(resolve).catch(reject);
      return;
    }
    let initialized=false;
    const initialize=userId=>{
      loadAccountData(userId).then(()=>{
        if(!initialized&&accountDataReady){initialized=true;resolve();}
      }).catch(error=>{
        if(!initialized){initialized=true;reject(error);}
      });
    };
    client.auth.onAuthStateChange((event,session)=>{
      const userId=session?.user?.id||null;
      if(!initialized||event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='USER_UPDATED'){
        initialize(userId);
      }
    });
    client.auth.getSession().then(({data,error})=>{
      if(error)throw error;
      if(!initialized)initialize(data.session?.user?.id||null);
    }).catch(error=>{
      console.error('VC Fashion cart and wishlist account could not be verified.',error);
      if(!initialized){initialized=true;reject(error);}
    });
  });
  window.FORME_CATALOG_READY?.then(loadedProducts=>{
    if(!Array.isArray(loadedProducts)||!loadedProducts.length)return;
    products=loadedProducts;
    cart=cart.map(item=>{
      const product=products.find(entry=>entry.id===item.id||entry.dbId===item.id);
      return product?{...item,id:product.id,size:item.size||product.defaultSize||'M',color:item.color||product.defaultColor||product.colors[0],unitPricePaise:item.unitPricePaise??Math.round(Number(product.price)*100)}:item;
    });
    cart=cart.flatMap(item=>{
      const product=products.find(entry=>entry.id===item.id);
      if(product?.source!=='supabase')return [item];
      const variant=product.variants?.find(entry=>entry.size===item.size&&entry.color_hex===item.color),stock=Number(variant?.stock);
      if(!variant||!Number.isInteger(stock))return [item];
      return [{...item,quantity:Math.max(1,Number(item.quantity)||1),unitPricePaise:item.unitPricePaise??Math.round(Number(product.price)*100),availableStock:item.availableStock??stock}];
    });
    persistCart();renderCart();
  });
})();
