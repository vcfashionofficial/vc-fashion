// Loads the live Supabase catalog and normalizes it to the existing UI shape.
(() => {
  const fallbackProducts = Array.isArray(window.FORME_PRODUCTS) ? window.FORME_PRODUCTS : [];
  window.FORME_CATALOG_SOURCE = 'loading';
  window.FORME_CATALOG_ERROR = null;
  const slugify = value => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const imagePlaceholder = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><rect width="600" height="760" fill="#eeede7"/><path d="M240 300h120l40 180H200z" fill="#dedcd3"/><circle cx="300" cy="250" r="55" fill="#dedcd3"/><text x="300" y="560" text-anchor="middle" font-family="sans-serif" font-size="18" letter-spacing="5" fill="#969586">VC FASHION</text></svg>');

  function rupeeValue(row, paiseKeys, rupeeKeys, fallbackValue=null) {
    for (const key of paiseKeys) if (row[key] !== null && row[key] !== undefined && row[key] !== '') return Number(row[key]) / 100;
    for (const key of rupeeKeys) if (row[key] !== null && row[key] !== undefined && row[key] !== '') return Number(row[key]);
    return fallbackValue;
  }

  // Reads the ordered product media manifest written by the admin panel. When
  // the media column is absent (migration not applied) the gallery simply
  // falls back to the single main image below, so nothing breaks.
  function readMediaEntries(row) {
    const raw = row.media;
    let list = Array.isArray(raw) ? raw : null;
    if (!list && typeof raw === 'string' && raw.trim()) {
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) list = parsed; } catch {}
    }
    if (!list) return [];
    return list
      .filter(entry => entry && typeof entry.path === 'string' && entry.path)
      .map(entry => ({path: entry.path, type: entry.type === 'video' ? 'video' : 'image'}));
  }

  async function galleryDetails(row, client, mainUrl) {
    const entries = readMediaEntries(row);
    const mainPath = row.image_path ?? row.main_image_path ?? '';
    const gallery = [];
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      if (mainPath && mainUrl && entry.path === mainPath) {
        gallery.push({type: entry.type, url: mainUrl});
        continue;
      }
      try {
        if (!client) throw new Error('Supabase Storage is unavailable.');
        const {data,error} = await client.storage.from('product-images').createSignedUrl(entry.path,3600);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error('Supabase did not return a signed media URL.');
        gallery.push({type: entry.type, url: data.signedUrl});
      } catch (error) {
        console.warn('VC Fashion could not create a signed URL for a product media file.', error);
      }
    }
    if (!gallery.length) return mainUrl ? [{type: 'image', url: mainUrl}] : [];
    if (!gallery.some(item => item.url === mainUrl)) gallery.unshift({type: 'image', url: mainUrl});
    return gallery;
  }

  async function imageDetails(row, fallback, client) {
    const storagePath = row.image_path ?? row.main_image_path ?? '';
    if (storagePath) {
      try {
        if (!client) throw new Error('Supabase Storage is unavailable.');
        const {data,error} = await client.storage.from('product-images').createSignedUrl(storagePath,3600);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error('Supabase did not return a signed image URL.');
        const gallery = await galleryDetails(row, client, data.signedUrl);
        return {image: fallback?.image || '', imageUrl: data.signedUrl, gallery};
      } catch (error) {
        console.warn('VC Fashion could not create a signed URL for a product image.', error);
        return fallback?.image ? {image:fallback.image,imageUrl:fallback.imageUrl||'',gallery:fallback.imageUrl?[{type:'image',url:fallback.imageUrl}]:[]} : {image:'',imageUrl:imagePlaceholder,gallery:[]};
      }
    }
    const value = row.image_url ?? row.image ?? fallback?.image ?? '';
    if (/^https?:\/\//i.test(value)) return {image:'',imageUrl:value,gallery:[{type:'image',url:value}]};
    if (/^photo-[\w-]+$/.test(value)) {
      const localFallback = fallback?.image === value ? fallback.imageUrl || '' : '';
      return {image:value,imageUrl:localFallback,gallery:localFallback?[{type:'image',url:localFallback}]:[]};
    }
    return fallback?.image ? {image:fallback.image,imageUrl:fallback.imageUrl||'',gallery:fallback.imageUrl?[{type:'image',url:fallback.imageUrl}]:[]} : {image:'',imageUrl:imagePlaceholder,gallery:[]};
  }

  async function normalizeProduct(row, categoriesById, variantsByProductId, client) {
    const rowId = String(row.id ?? row.product_id ?? '');
    const rowSlug = String(row.slug ?? row.handle ?? '');
    const fallback = fallbackProducts.find(item =>
      String(row.legacy_id ?? '') === String(item.id) ||
      rowId === String(item.id) ||
      rowSlug === item.id || rowSlug === slugify(item.name) ||
      String(row.name ?? '').trim().toLowerCase() === item.name.toLowerCase()
    );
    const categoryId = row.category_id ?? row.categoryId ?? null;
    const joinedCategory = row.categories ?? row.category ?? null;
    const categoryRecord = categoriesById.get(String(categoryId)) || (Array.isArray(joinedCategory) ? joinedCategory[0] : joinedCategory);
    const categoryName = typeof categoryRecord === 'string'
      ? categoryRecord
      : (categoryRecord?.name ?? categoryRecord?.title ?? fallback?.category ?? 'Uncategorized');
    const variants = (variantsByProductId.get(rowId) || []).map(variant => ({
      id: variant.id ?? null,
      sku: variant.sku ?? '',
      size: String(variant.size ?? ''),
      color: String(variant.color_name ?? variant.colorName ?? 'Default'),
      color_hex: String(variant.color_hex ?? variant.hex ?? '#d8d5ce'),
      stock: variant.stock === null || variant.stock === undefined ? null : Number(variant.stock)
    }));
    const uniqueVariants = variants.filter((variant, index) => variants.findIndex(item => item.size === variant.size && item.color === variant.color && item.color_hex === variant.color_hex) === index);
    const sizes = [...new Set(uniqueVariants.map(variant => variant.size).filter(Boolean))];
    const colorVariants = uniqueVariants.filter((variant, index) => uniqueVariants.findIndex(item => item.color === variant.color && item.color_hex === variant.color_hex) === index);
    const colors = colorVariants.map(variant => variant.color_hex);
    const colorNames = colorVariants.map(variant => variant.color);
    const availableVariant = uniqueVariants.find(variant => variant.stock === null || variant.stock > 0);
    const defaultVariant = availableVariant || uniqueVariants[0];
    const image = await imageDetails(row, fallback, client);
    const price = rupeeValue(row, ['price_paise'], ['price', 'current_price'], fallback?.price ?? 0);
    const oldPrice = rupeeValue(row, ['compare_at_price_paise', 'old_price_paise'], ['compare_at_price', 'old_price'], fallback?.oldPrice ?? null);
    const isNew = Boolean(row.is_new ?? row.isNew ?? fallback?.isNew ?? false);
    const best = Boolean(row.is_best_seller ?? row.best_seller ?? row.best ?? fallback?.best ?? false);

    return {
      id: String(row.legacy_id ?? row.legacyId ?? fallback?.id ?? rowSlug ?? rowId),
      dbId: rowId,
      legacyId: row.legacy_id ?? fallback?.id ?? null,
      slug: rowSlug || slugify(row.name),
      name: String(row.name ?? fallback?.name ?? 'Untitled product'),
      description: String(row.description ?? fallback?.description ?? ''),
      category: categoryName,
      categoryId,
      price,
      oldPrice,
      image: image.image,
      imageUrl: image.imageUrl,
      gallery: image.gallery || [],
      badge: String(row.badge ?? fallback?.badge ?? (isNew ? 'New arrival' : best ? 'Bestseller' : 'VC Fashion essential')),
      rating: Number(row.rating ?? fallback?.rating ?? 0),
      colors,
      colorNames,
      sizes,
      variants: uniqueVariants,
      defaultSize: defaultVariant?.size || (fallback?.sizes?.includes('M') ? 'M' : sizes[0] || ''),
      defaultColor: defaultVariant?.color_hex || colors[0] || '',
      inStock: uniqueVariants.length === 0 ? Boolean(fallback) : Boolean(availableVariant),
      isNew,
      best,
      sortOrder: Number(row.sort_order ?? 0),
      source: 'supabase'
    };
  }

  async function loadProducts() {
    const client = window.FORME_SUPABASE;
    if (!client) {
      const error = new Error('The product catalog service is unavailable. Please try again later.');
      window.FORME_CATALOG_SOURCE = 'unavailable';
      window.FORME_CATALOG_ERROR = error;
      window.FORME_PRODUCTS = [];
      window.FORME_CATEGORIES = [];
      return [];
    }

    try {
      const [productsResult, categoriesResult, variantsResult] = await Promise.all([
        client.from('products').select('*'),
        client.from('categories').select('*'),
        client.from('product_variants').select('*')
      ]);
      for (const result of [productsResult, categoriesResult, variantsResult]) if (result.error) throw result.error;
      if (!Array.isArray(productsResult.data)) throw new Error('Supabase returned an invalid product catalog response.');

      const categoriesById = new Map();
      for (const category of categoriesResult.data || []) {
        if (category.id !== null && category.id !== undefined) categoriesById.set(String(category.id), category);
        if (category.slug) categoriesById.set(String(category.slug), category);
      }
      window.FORME_CATEGORIES = (categoriesResult.data || []).map(category=>({id:String(category.id),name:String(category.name??category.title??category.slug??''),slug:String(category.slug??slugify(category.name??category.title))})).filter(category=>category.name);
      const variantsByProductId = new Map();
      for (const variant of variantsResult.data || []) {
        const key = String(variant.product_id ?? '');
        if (!variantsByProductId.has(key)) variantsByProductId.set(key, []);
        variantsByProductId.get(key).push(variant);
      }
      const products = await Promise.all(productsResult.data
        .filter(row => Boolean(row.is_active ?? row.active ?? true))
        .map(row => normalizeProduct(row, categoriesById, variantsByProductId, client)));
      products.sort((a,b) => a.sortOrder - b.sortOrder);

      window.FORME_PRODUCTS = products;
      window.FORME_CATALOG_SOURCE = 'supabase';
      window.FORME_CATALOG_ERROR = null;
      return products;
    } catch (error) {
      console.error('VC Fashion could not load its Supabase catalog.', error);
      window.FORME_CATALOG_SOURCE = 'unavailable';
      window.FORME_CATALOG_ERROR = error;
      window.FORME_PRODUCTS = [];
      window.FORME_CATEGORIES = [];
      return [];
    }
  }

  window.FORME_CATALOG_READY = loadProducts();
})();
