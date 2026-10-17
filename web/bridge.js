/* The legacy renderer API stays stable; all privileged operations are Rust commands.
   No direct HTTP, filesystem, or shell access is exposed to the frontend. */
'use strict';
const invokeHub = (command, args = {}) => {
  if (!window.__TAURI__?.core?.invoke) return Promise.reject(new Error('Запускайте Software Hub через Tauri EXE, а не через HTML.'));
  return window.__TAURI__.core.invoke(command, args);
};
Object.defineProperty(window, 'softwareHub', {
  configurable: false,
  writable: false,
  value: Object.freeze({
    getCatalog: () => invokeHub('get_catalog'),
    openExternal: (url) => invokeHub('open_external', { url }),
    copyCatalogText: (value) => invokeHub('copy_catalog_text', { value }),
    checkVersion: (programId, maxTimeoutMs = null) => invokeHub('check_version', { programId, maxTimeoutMs }),
    getVersionCache: () => invokeHub('get_version_cache'),
    setVersionCache: (cache) => invokeHub('set_version_cache', { cache }),
    getStartupRefreshIds: () => invokeHub('get_startup_refresh_ids'),
    isInternetAvailable: () => invokeHub('is_internet_available'),
    startVersionCheckLog: (mode, planned) => invokeHub('start_version_check_log', { mode, planned }),
    appendVersionCheckLog: (logId, event) => invokeHub('append_version_check_log', { logId, event }),
    finishVersionCheckLog: (logId, summary) => invokeHub('finish_version_check_log', { logId, summary })
  })
});
for (const [button, action] of [['windowMinimize','minimize_window'],['windowClose','close_window']]) {
  document.getElementById(button)?.addEventListener('click', () => { void invokeHub(action).catch(console.error); });
}


// Independent of renderer.js: if its script fails to run, the initial screen
// must not remain in an endless "loading" state. Keep native window controls
// reachable and provide a user-initiated retry (never auto-loop).
const STARTUP_WATCHDOG_MS = 12000;
setTimeout(() => {
  if (document.documentElement?.dataset?.startup !== 'loading') return;
  const status = document.getElementById('startupStatus');
  if (status) status.textContent = 'Загрузка заняла слишком много времени. Можно попробовать ещё раз.';
  document.getElementById('startupRetry')?.classList.remove('hidden');
}, STARTUP_WATCHDOG_MS);
document.getElementById('startupRetry')?.addEventListener('click', () => window.location.reload());
