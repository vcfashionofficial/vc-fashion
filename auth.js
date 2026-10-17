(() => {
  const client = window.FORME_SUPABASE;
  const params = new URLSearchParams(window.location.search);
  const $ = id => document.getElementById(id);
  const options = $('auth-options');
  const emailForm = $('email-form');
  const resetForm = $('reset-form');
  const messageBox = $('auth-message');
  const destination = safeDestination(params.get('return') || params.get('next'));
  const authCallbackUrl = new URL('auth.html', window.location.href);
  let activeEmailMode = 'signin';
  let submitting = false;
  let recoveryMode = false;

  $('auth-back-button').addEventListener('click', () => {
    try {
      const previousPage = new URL(document.referrer);
      if (previousPage.origin === window.location.origin && !previousPage.pathname.endsWith('/auth.html')) {
        window.history.back();
        return;
      }
    } catch {}
    window.location.assign('index.html');
  });

  function safeDestination(value) {
    if (!value) return 'orders.html';
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin || url.protocol !== window.location.protocol || url.pathname.endsWith('/auth.html')) return 'orders.html';
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return 'orders.html';
    }
  }

  function callbackUrl(mode) {
    const url = new URL(authCallbackUrl);
    url.searchParams.set('return', destination);
    if (mode) url.searchParams.set('mode', mode);
    return url.toString();
  }

  function setMessage(text, type = 'success') {
    messageBox.textContent = text;
    messageBox.className = `auth-message${text ? ` is-${type}` : ''}`;
  }

  function showForm(form) {
    options.hidden = form !== null;
    emailForm.hidden = form !== emailForm;
    resetForm.hidden = form !== resetForm;
    $('signed-in-view').hidden = true;
    setMessage('');
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy) {
      button.dataset.originalLabel = button.innerHTML;
      button.innerHTML = `${label}<span aria-hidden="true">…</span>`;
    } else if (button.dataset.originalLabel) {
      button.innerHTML = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  function redirectAfterAuth() {
    window.location.replace(destination);
  }

  function showSignedIn(user) {
    options.hidden = true;
    emailForm.hidden = true;
    resetForm.hidden = true;
    $('signed-in-view').hidden = false;
    $('signed-in-email').textContent = user.email || user.phone || 'your account';
    $('account-link').href = 'orders.html';
    $('account-link').innerHTML = 'Go to My Orders <span aria-hidden="true">→</span>';
  }

  function authErrorText(error, context) {
    const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    if (text.includes('invalid login credentials')) return 'That email and password do not match. Check them and try again.';
    if (text.includes('email not confirmed')) return 'Please verify your email using the link we sent before signing in.';
    if (text.includes('already registered') || text.includes('already been registered') || text.includes('user already exists')) return 'An account may already exist for this email. Try signing in or reset your password.';
    if (text.includes('password') && (text.includes('length') || text.includes('weak'))) return 'Choose a stronger password with at least 8 characters.';
    if (text.includes('expired') || text.includes('invalid token') || text.includes('otp_expired')) return 'That link or code has expired. Request a new one and try again.';
    if (text.includes('rate limit') || text.includes('too many requests')) return 'Too many attempts. Please wait a little while before trying again.';
    if (text.includes('provider is not enabled') || text.includes('unsupported provider') || text.includes('provider_disabled')) return 'Google sign-in is not enabled yet. An administrator must configure the Google provider in Supabase.';
    if (text.includes('network') || text.includes('fetch')) return 'We could not reach the sign-in service. Check your connection and try again.';
    if (context === 'google' && (text.includes('access_denied') || text.includes('cancel'))) return 'Google sign-in was cancelled. You can try again whenever you’re ready.';
    return error?.message || 'Something went wrong. Please try again.';
  }

  function setEmailMode(mode) {
    activeEmailMode = mode;
    const signup = mode === 'signup';
    $('auth-title').innerHTML = signup ? 'Create your <em>account.</em>' : 'Welcome <em>back.</em>';
    $('auth-intro').textContent = signup ? 'Create an account to keep your VC Fashion orders together.' : 'Sign in or create an account to see your orders.';
    $('email-form-title').textContent = signup ? 'Create account with email' : 'Sign in with email';
    $('email-mode-toggle').textContent = signup ? 'Sign in instead' : 'Create account';
    $('forgot-password').hidden = signup;
    $('confirm-password-label').hidden = !signup;
    $('confirm-password-wrap').hidden = !signup;
    $('confirm-password').required = signup;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('email-submit').innerHTML = signup ? 'Create account <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
    showForm(emailForm);
    $('email').focus();
  }

  $('email-option').addEventListener('click', () => setEmailMode('signin'));
  $('create-account-option').addEventListener('click', () => setEmailMode('signup'));
  $('email-options-back').addEventListener('click', () => {
    showForm(null);
    $('email-option').focus();
  });
  $('google-option').addEventListener('click', async event => {
    if (!client || submitting) return;
    if (window.location.protocol === 'file:') {
      setMessage('Google OAuth cannot complete on a file URL. Serve this site over localhost and allow that callback URL in Supabase.', 'info');
      return;
    }
    const button = event.currentTarget;
    submitting = true;
    setBusy(button, true, 'Connecting to Google');
    setMessage('');
    try {
      if (window.location.protocol === 'file:') throw new Error('Google sign-in requires a local web server and a Supabase-allowed redirect URL; file URLs cannot complete OAuth.');
      const {data, error} = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {redirectTo: callbackUrl(),skipBrowserRedirect:true}
      });
      if (error) throw error;
      if (!data?.url) throw new Error('Supabase did not return a Google sign-in URL.');
      window.location.assign(data.url);
    } catch (error) {
      setMessage(authErrorText(error, 'google'), 'error');
      setBusy(button, false);
      submitting = false;
    }
  });

  $('email-mode-toggle').addEventListener('click', () => setEmailMode(activeEmailMode === 'signup' ? 'signin' : 'signup'));
  $('forgot-password').addEventListener('click', () => {
    showForm(resetForm);
    $('reset-email').value = $('email').value;
    $('reset-email').focus();
  });

  for (const [buttonId,inputId] of [['toggle-password','password'],['toggle-confirm-password','confirm-password'],['toggle-new-password','new-password']]) {
    $(buttonId).addEventListener('click', event => {
      const input = $(inputId);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      event.currentTarget.textContent = reveal ? 'Hide' : 'Show';
      event.currentTarget.setAttribute('aria-pressed', String(reveal));
      event.currentTarget.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${inputId.replaceAll('-', ' ')}`);
    });
  }

  emailForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || submitting || !emailForm.reportValidity()) return;
    const email = $('email').value.trim();
    const password = $('password').value;
    if (activeEmailMode === 'signup' && password !== $('confirm-password').value) {
      setMessage('Your passwords do not match.', 'error');
      $('confirm-password').focus();
      return;
    }
    submitting = true;
    setBusy($('email-submit'), true, activeEmailMode === 'signup' ? 'Creating account' : 'Signing in');
    setMessage('');
    try {
      if (activeEmailMode === 'signup') {
        const {data,error} = await client.auth.signUp({email,password,options:{emailRedirectTo:callbackUrl()}});
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMessage('An account may already exist for this email. Try signing in or reset your password.', 'error');
        } else if (data.session) {
          redirectAfterAuth();
          return;
        } else {
          setMessage('Check your email for a verification link to finish creating your account.', 'info');
        }
      } else {
        const {data,error} = await client.auth.signInWithPassword({email,password});
        if (error) throw error;
        if (!data.session) {
          setMessage('Sign-in did not create a session. Please try again.', 'error');
        } else {
          redirectAfterAuth();
          return;
        }
      }
    } catch (error) {
      setMessage(authErrorText(error, 'email'), 'error');
    } finally {
      setBusy($('email-submit'), false);
      submitting = false;
    }
  });

  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || submitting) return;
    if (recoveryMode) {
      if (!$('new-password').reportValidity()) return;
      submitting = true;
      setBusy($('save-password'), true, 'Updating password');
      setMessage('');
      try {
        const {error} = await client.auth.updateUser({password:$('new-password').value});
        if (error) throw error;
        recoveryMode = false;
        setMessage('Your password has been updated. You can now continue to your account.', 'success');
        window.setTimeout(redirectAfterAuth, 900);
      } catch (error) {
        setMessage(authErrorText(error, 'reset'), 'error');
      } finally {
        setBusy($('save-password'), false);
        submitting = false;
      }
      return;
    }
    if (!$('reset-email').reportValidity()) return;
    submitting = true;
    setBusy($('reset-email-submit'), true, 'Sending reset link');
    setMessage('');
    try {
      const {error} = await client.auth.resetPasswordForEmail($('reset-email').value.trim(),{redirectTo:callbackUrl('reset')});
      if (error) throw error;
      setMessage('If an account exists for that email, a password-reset link is on its way.', 'info');
    } catch (error) {
      setMessage(authErrorText(error, 'reset'), 'error');
    } finally {
      setBusy($('reset-email-submit'), false);
      submitting = false;
    }
  });

  $('reset-back').addEventListener('click', () => {
    recoveryMode = false;
    $('reset-email-step').hidden = false;
    $('new-password-step').hidden = true;
    $('reset-email').required = true;
    $('new-password').required = false;
    setEmailMode('signin');
  });

  $('customer-signout').addEventListener('click', async event => {
    if (!client || submitting) return;
    const button = event.currentTarget;
    submitting = true;
    setBusy(button, true, 'Signing out');
    try {
      const {error} = await client.auth.signOut();
      if (error) throw error;
      window.location.replace('auth.html');
    } catch (error) {
      setMessage(authErrorText(error, 'signout'), 'error');
    } finally {
      setBusy(button, false);
      submitting = false;
    }
  });

  if (!client) {
    options.hidden = true;
    setMessage('Account sign-in is unavailable because Supabase is not configured. Check the public project URL and publishable key configuration.', 'error');
    return;
  }

  const callbackError = params.get('error_description') || params.get('error');
  if (callbackError) setMessage(authErrorText(new Error(callbackError), 'google'), 'error');
  client.auth.onAuthStateChange((event,session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      showForm(resetForm);
      $('reset-email-step').hidden = true;
      $('new-password-step').hidden = false;
      $('reset-email').required = false;
      $('new-password').required = true;
      $('new-password').focus();
      setMessage('Choose a new password for your account.', 'info');
    } else if (event === 'SIGNED_OUT') {
      showForm(null);
    } else if (event === 'SIGNED_IN' && session?.user && params.has('code')) {
      redirectAfterAuth();
    }
  });

  client.auth.getSession().then(({data,error}) => {
    if (error) throw error;
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    recoveryMode = recoveryMode || (params.get('mode') === 'reset' && (hashParams.get('type') === 'recovery' || params.get('type') === 'recovery'));
    if (recoveryMode) {
      showForm(resetForm);
      $('reset-email-step').hidden = true;
      $('new-password-step').hidden = false;
      $('reset-email').required = false;
      $('new-password').required = true;
      $('new-password').focus();
      setMessage('Choose a new password for your account.', 'info');
    } else if (data.session?.user) {
      showSignedIn(data.session.user);
    } else if (params.get('mode') === 'signup') {
      setEmailMode('signup');
    } else if (params.get('mode') === 'reset') {
      showForm(resetForm);
    } else if (callbackError) {
      setMessage(authErrorText(new Error(callbackError), 'google'), 'error');
    }
  }).catch(error => {
    setMessage(authErrorText(error, 'session'), 'error');
  });
})();
