(() => {
  'use strict';
  const status = document.getElementById('pricing-status');
  const rows = document.getElementById('pricing-rows');
  const retry = document.getElementById('pricing-retry');
  const money = new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:2});

  function setMessage(message, canRetry=false) {
    status.textContent = message;
    retry.hidden = !canRetry;
  }

  function priceInRupees(row) {
    for (const key of ['price_paise']) {
      if (row[key] !== null && row[key] !== undefined && row[key] !== '') {
        const value = Number(row[key]) / 100;
        return Number.isFinite(value) ? value : null;
      }
    }
    for (const key of ['price','current_price']) {
      if (row[key] !== null && row[key] !== undefined && row[key] !== '') {
        const value = Number(row[key]);
        return Number.isFinite(value) ? value : null;
      }
    }
    return null;
  }

  async function loadPrices() {
    rows.replaceChildren();
    retry.hidden = true;
    const client = window.FORME_SUPABASE;
    if (!client) {
      setMessage('Live prices are temporarily unavailable. Please try again later.', true);
      return;
    }

    setMessage('Loading current prices…');
    try {
      const {data,error} = await client.from('products').select('name,price_paise,is_active,sort_order');
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('The catalog response is unavailable.');
      const activeProducts = data
        .filter(row => Boolean(row.is_active ?? row.active ?? true))
        .sort((a,b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));

      if (!activeProducts.length) {
        setMessage('There are no active products listed right now.');
        return;
      }

      let listed = 0;
      for (const product of activeProducts) {
        const price = priceInRupees(product);
        if (price === null) continue;
        const row = document.createElement('tr');
        const name = document.createElement('td');
        const amount = document.createElement('td');
        name.textContent = String(product.name ?? 'Product');
        amount.textContent = money.format(price);
        row.append(name, amount);
        rows.append(row);
        listed++;
      }
      setMessage(listed ? 'Prices shown are read from the current active product catalogue.' : 'Current prices are unavailable. Please contact support.');
    } catch (error) {
      console.error('VC Fashion could not load current product prices.', error);
      setMessage('Live prices are temporarily unavailable. Please try again later.', true);
    }
  }

  retry.addEventListener('click', loadPrices);
  loadPrices();
})();
