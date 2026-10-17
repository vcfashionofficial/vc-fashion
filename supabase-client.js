(() => {
  const config = window.FORME_SUPABASE_CONFIG || {};
  const createClient = window.supabase?.createClient;

  if (!createClient || !config.url || !config.publishableKey) {
    window.FORME_SUPABASE = null;
    return;
  }

  try {
    window.FORME_SUPABASE = createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  } catch (error) {
    console.error('VC Fashion Supabase client could not be initialized.', error);
    window.FORME_SUPABASE = null;
  }
})();
