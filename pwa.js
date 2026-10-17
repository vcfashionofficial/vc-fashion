// VC Fashion PWA support: registers the service worker and provides a safe,
// honest install affordance. The browser's native install prompt is used only
// where it is actually exposed; for every other browser (notably iPhone/iPad
// Safari) clear per-platform instructions are shown instead. This script is
// loaded on customer-facing pages only — never on the admin panel.
(() => {
  'use strict';

  // A service worker requires a secure context: HTTPS in deployment, or
  // localhost/127.0.0.1 during development.
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const isSecureContext = location.protocol === 'https:' || isLocalhost;
  if (isSecureContext && 'serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(error => {
        console.warn('VC Fashion offline support could not be started.', error);
      });
    });
  }

  const installButton = document.getElementById('install-app');
  const instructionsPanel = document.getElementById('install-instructions');
  if (!installButton && !instructionsPanel) return;

  const standaloneQuery = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  const isStandalone = (standaloneQuery && standaloneQuery.matches) || navigator.standalone === true;

  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isChromiumFamily = /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
  // Only Chromium on Android/desktop fires beforeinstallprompt; WebKit (Safari,
  // iOS Chrome) never does, so those browsers get instructions instead.
  const mayExposeInstallPrompt = isChromiumFamily && !isIos;

  let deferredPrompt = null;

  const hideInstallUi = () => {
    if (installButton) installButton.hidden = true;
    if (instructionsPanel) instructionsPanel.hidden = true;
  };

  const installationSteps = () => {
    if (isIos) {
      return {
        title: 'Add VC Fashion to your Home Screen',
        steps: [
          'In Safari, tap the Share button (a square with an upward arrow).',
          'Scroll down and choose “Add to Home Screen”, then tap Add.',
          'The VC Fashion app icon appears on your Home Screen.'
        ]
      };
    }
    if (isAndroid) {
      return {
        title: 'Install the VC Fashion app',
        steps: [
          'Tap the ⋮ menu in Chrome (or your browser).',
          'Choose “Install app” or “Add to Home screen”.',
          'Confirm with Install — the app opens in its own window.'
        ]
      };
    }
    return {
      title: 'Install VC Fashion on your computer',
      steps: [
        'Look for the install icon in your browser’s address bar, or',
        'Open the browser menu and choose “Install VC Fashion” / “Install this site as an app”.',
        'Some browsers do not offer an install option — you can keep browsing in a tab or bookmark the shop instead.'
      ]
    };
  };

  const showInstructions = () => {
    if (!instructionsPanel) return;
    const { title, steps } = installationSteps();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const list = document.createElement('ul');
    for (const step of steps) {
      const item = document.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    }
    instructionsPanel.replaceChildren(heading, list);
    instructionsPanel.hidden = false;
  };

  if (isStandalone) {
    // Already installed: no install controls needed.
    hideInstallUi();
  } else if (installButton && !mayExposeInstallPrompt) {
    // Browsers without the install-prompt API show the button immediately; it
    // opens written instructions rather than pretending a prompt exists.
    installButton.hidden = false;
  }

  addEventListener('beforeinstallprompt', event => {
    // Chromium qualifies for the native prompt: keep it and reveal the button.
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone && installButton) installButton.hidden = false;
  });

  addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallUi();
  });

  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch {
          // The prompt was already handled; nothing further to do.
        }
        deferredPrompt = null;
        if (instructionsPanel) instructionsPanel.hidden = true;
        if (mayExposeInstallPrompt) installButton.hidden = true;
        return;
      }
      showInstructions();
    });
  }
})();
