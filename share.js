(() => {
  const buildProductUrl = (productId, baseUrl = window.location.href) => {
    const url = new URL('product.html', baseUrl);
    url.search = '';
    url.searchParams.set('id', String(productId));
    url.hash = '';
    return url.href;
  };
  const priceLabel = value => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2
  }).format(Number(value));
  const makePayload = (productId, name, price, baseUrl = window.location.href) => {
    const url = buildProductUrl(productId, baseUrl);
    const text = `${name} — ${priceLabel(price)} at VC Fashion`;
    return {title: `${name} | VC Fashion`, text, url};
  };
  const getSocialUrls = payload => ({
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${payload.text}\n${payload.url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(payload.url)}`
  });

  let menu;
  let activeTrigger;
  const toast = message => {
    const box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove('is-visible'), 2600);
  };
  const closeMenu = () => {
    if (menu) menu.hidden = true;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
  };
  const makeMenu = () => {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'share-menu';
    menu.id = 'share-menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Share product');
    menu.hidden = true;
    document.body.append(menu);
    return menu;
  };
  const positionMenu = (trigger, panel) => {
    const rect = trigger.getBoundingClientRect();
    const width = 220;
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 220)}px`;
  };
  const openMenu = trigger => {
    const panel = makeMenu();
    const nativeAvailable = typeof navigator.share === 'function';
    panel.innerHTML = `${nativeAvailable ? '<button type="button" data-share-action="native">Share with an app…</button><p class="share-menu-note">Instagram may be available in your device share sheet.</p>' : ''}<button type="button" data-share-action="whatsapp">WhatsApp</button><button type="button" data-share-action="facebook">Facebook</button><button type="button" data-share-action="copy">Copy link</button>`;
    if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', 'share-menu');
    positionMenu(trigger, panel);
    panel.hidden = false;
  };

  const copyText = async value => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    field.remove();
    return copied;
  };

  document.addEventListener('click', async event => {
    const trigger = event.target.closest('[data-share-product]');
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof navigator.share === 'function') {
        const payload = makePayload(trigger.dataset.shareProduct, trigger.dataset.shareName, trigger.dataset.sharePrice);
        try {
          await navigator.share(payload);
          closeMenu();
        } catch (error) {
          if (error?.name === 'AbortError') return;
          openMenu(trigger);
          toast('Sharing could not be started. Choose WhatsApp, Facebook, or Copy link.');
        }
      } else if (activeTrigger === trigger && menu && !menu.hidden) closeMenu();
      else openMenu(trigger);
      return;
    }
    const action = event.target.closest('[data-share-action]');
    if (action && menu?.contains(action) && activeTrigger) {
      event.preventDefault();
      event.stopPropagation();
      const payload = makePayload(activeTrigger.dataset.shareProduct, activeTrigger.dataset.shareName, activeTrigger.dataset.sharePrice);
      const social = getSocialUrls(payload);
      if (action.dataset.shareAction === 'copy') {
        closeMenu();
        toast(await copyText(payload.url) ? 'Product link copied.' : 'Could not copy the link. Please copy it from the address bar.');
      } else if (action.dataset.shareAction === 'native') {
        try {
          await navigator.share(payload);
          closeMenu();
        } catch (error) {
          if (error?.name !== 'AbortError') toast('Sharing could not be started. Choose WhatsApp, Facebook, or Copy link.');
          closeMenu();
        }
      } else {
        const target = action.dataset.shareAction === 'whatsapp' ? social.whatsapp : social.facebook;
        window.open(target, '_blank', 'noopener,noreferrer');
        closeMenu();
      }
      return;
    }
    if (menu && !menu.hidden && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (menu && !menu.hidden && activeTrigger) positionMenu(activeTrigger, menu);
  });

  window.FormeProductShare = {buildProductUrl, makePayload, getSocialUrls, copyText};
})();
