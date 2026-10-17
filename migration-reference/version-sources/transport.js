'use strict';

const { normalizeHttpsUrl, resolveHttpsRedirect, isRedirectStatus } = require('../network-rules');

const MAX_REMOTE_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_HTTPS_REDIRECTS = 6;
const BLOCKED_RENDERED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'stylesheet']);

function usesLightRenderedResourcePolicy(sourceConfig = {}) {
  return String(sourceConfig.renderedPageResourcePolicy || 'light').toLowerCase() !== 'full';
}

function networkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function shouldBlockRenderedResource(resourceType) {
  return BLOCKED_RENDERED_RESOURCE_TYPES.has(String(resourceType || ''));
}

function createTransport({ BrowserWindow, net, execFileAsync, isAllowedRenderedNavigation, denyAllSessionPermissions, limitRenderedText, userAgent, maxRenderedTextChars = 1024 * 1024, platform = process.platform }) {
  const USER_AGENT = userAgent;
  const MAX_RENDERED_TEXT_CHARS = maxRenderedTextChars;
  const optimizedRenderedSessions = new WeakSet();

  function requestSignal(timeoutMs, externalSignal = null) {
    const timeoutSignal = AbortSignal.timeout(Math.max(250, Number(timeoutMs) || 12000));
    if (!externalSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([externalSignal, timeoutSignal]);
    const controller = new AbortController();
    const abort = (signal) => {
      if (!controller.signal.aborted) controller.abort(signal?.reason);
    };
    if (externalSignal.aborted) abort(externalSignal);
    else externalSignal.addEventListener('abort', () => abort(externalSignal), { once: true });
    timeoutSignal.addEventListener('abort', () => abort(timeoutSignal), { once: true });
    return controller.signal;
  }

  async function fetchHttps(url, init = {}, maxRedirects = MAX_HTTPS_REDIRECTS) {
    let currentUrl = normalizeHttpsUrl(url);
    if (!currentUrl) throw networkError('https-required', 'Источник версий должен использовать HTTPS.');

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await net.fetch(currentUrl, { ...init, cache: 'no-store', redirect: 'manual' });
      const location = response?.headers?.get?.('location') || '';
      if (isRedirectStatus(response?.status) && location) {
        if (hop >= maxRedirects) throw networkError('too-many-redirects', 'Слишком много перенаправлений HTTPS.');
        const nextUrl = resolveHttpsRedirect(location, currentUrl);
        if (!nextUrl) throw networkError('insecure-redirect', 'Источник попытался перенаправить HTTPS-запрос на небезопасный адрес.');
        currentUrl = nextUrl;
        continue;
      }

      const responseUrl = normalizeHttpsUrl(response?.url || currentUrl);
      if (!responseUrl) throw networkError('insecure-final-url', 'Источник завершил запрос на небезопасном адресе.');
      return { response, finalUrl: responseUrl };
    }

    throw networkError('too-many-redirects', 'Слишком много перенаправлений HTTPS.');
  }

  async function readResponseTextLimited(response, maxBytes = MAX_REMOTE_TEXT_BYTES) {
    const limit = Math.max(1024, Number(maxBytes) || MAX_REMOTE_TEXT_BYTES);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > limit) throw networkError('response-too-large', `Remote response exceeds ${limit} bytes.`);
    if (!response.body || typeof response.body.getReader !== 'function') {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > limit) throw networkError('response-too-large', `Remote response exceeds ${limit} bytes.`);
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch {}
        throw networkError('response-too-large', `Remote response exceeds ${limit} bytes.`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  async function fetchRemoteText(url, sourceConfig = {}, context = {}) {
    if (!normalizeHttpsUrl(url)) return { ok: false, reason: 'https-required', message: 'Источник версий должен использовать HTTPS.' };
    const timeoutMs = Number(sourceConfig.timeoutMs || 12000);
    const headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(sourceConfig.headers || {})
    };
    const currentUserAgent = headers['User-Agent'] || USER_AGENT;
    headers['User-Agent'] = currentUserAgent;
    let firstFailure = null;

    try {
      const { response, finalUrl } = await fetchHttps(url, {
        headers,
        signal: requestSignal(timeoutMs, context.signal)
      });
      if (response.ok) {
        return { ok: true, text: await readResponseTextLimited(response), transport: 'fetch', status: response.status, finalUrl };
      }
      firstFailure = { reason: `HTTP ${response.status}`, message: `Страница вернула HTTP ${response.status}.` };
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'timeout' : (error?.code || 'network');
      firstFailure = {
        reason,
        message: error?.name === 'TimeoutError' ? 'Таймаут страницы.' : (error?.message || 'Сетевая ошибка.')
      };
    }

    if (context.signal?.aborted) return { ok: false, reason: 'check-timeout', message: 'Проверка источника была остановлена по таймауту.' };

    // Windows ships curl.exe. Restrict both the original request and every
    // redirect to HTTPS so the fallback cannot silently downgrade transport.
    if (platform === 'win32' && sourceConfig.disableCurlFallback !== true) {
      try {
        const args = [
          '-L', '-sS', '--fail', '--max-time', String(Math.ceil(timeoutMs / 1000)),
          '--proto', '=https', '--proto-redir', '=https',
          '-A', currentUserAgent,
          '-H', `Accept: ${headers.Accept}`,
          '-H', `Accept-Language: ${headers['Accept-Language']}`,
          url
        ];
        const { stdout = '' } = await execFileAsync('curl.exe', args, {
          windowsHide: true,
          maxBuffer: MAX_REMOTE_TEXT_BYTES,
          timeout: timeoutMs + 2000,
          signal: context.signal
        });
        if (stdout) return { ok: true, text: stdout, transport: 'curl', status: 200, finalUrl: normalizeHttpsUrl(url) };
      } catch (error) {
        return {
          ok: false,
          reason: 'remote-fetch-failed',
          message: `${firstFailure?.message || 'Страница недоступна.'} Резервный запрос curl.exe также не удался: ${error?.message || 'неизвестная ошибка'}`
        };
      }
    }

    return { ok: false, ...(firstFailure || { reason: 'network', message: 'Не удалось получить страницу.' }) };
  }

  async function fetchRenderedPageText(url, sourceConfig = {}, context = {}, readyPattern = null) {
    if (!normalizeHttpsUrl(url)) return { ok: false, reason: 'https-required', message: 'Динамический источник должен использовать HTTPS.' };
    const timeoutMs = Math.max(1000, Number(sourceConfig.renderedPageTimeoutMs || sourceConfig.timeoutMs || 8000));
    const pollMs = Math.max(100, Math.min(1000, Number(sourceConfig.renderedPagePollMs || 250)));
    const signal = requestSignal(timeoutMs, context.signal);
    let win = null;
    let checkerSession = null;
    let onWillDownload = null;
    let onAbort = null;
    const abortPromise = new Promise((resolve) => {
      if (signal.aborted) return resolve({ aborted: true });
      onAbort = () => resolve({ aborted: true });
      signal.addEventListener('abort', onAbort, { once: true });
    });

    const aborted = () => ({
      ok: false,
      reason: context.signal?.aborted ? 'check-timeout' : 'render-timeout',
      message: context.signal?.aborted ? 'Проверка источника была остановлена по таймауту.' : 'Динамическая страница не успела отдать данные.'
    });

    try {
      if (signal.aborted) return aborted();
      win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          backgroundThrottling: false,
          partition: usesLightRenderedResourcePolicy(sourceConfig) ? 'software-hub-source-check' : 'software-hub-source-check-full'
        }
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const renderedExtraOrigins = sourceConfig.renderedPageAllowedOrigins || [];
      const guardRenderedNavigation = (event, navigationUrl) => {
        if (!isAllowedRenderedNavigation(navigationUrl, url, renderedExtraOrigins)) event.preventDefault();
      };
      win.webContents.on('will-navigate', guardRenderedNavigation);
      win.webContents.on('will-redirect', guardRenderedNavigation);
      checkerSession = win.webContents.session;
      denyAllSessionPermissions(checkerSession);
      if (usesLightRenderedResourcePolicy(sourceConfig) && !optimizedRenderedSessions.has(checkerSession)) {
        optimizedRenderedSessions.add(checkerSession);
        try {
          checkerSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (details, callback) => {
            callback({ cancel: shouldBlockRenderedResource(details.resourceType) });
          });
        } catch {}
      }
      onWillDownload = (event) => event.preventDefault();
      checkerSession.on('will-download', onWillDownload);

      const customUserAgent = sourceConfig.headers?.['User-Agent'];
      if (customUserAgent) win.webContents.setUserAgent(customUserAgent);

      const loadOutcome = await Promise.race([
        win.loadURL(url).then(() => ({ loaded: true })).catch((error) => ({ error })),
        abortPromise
      ]);
      if (loadOutcome?.aborted || signal.aborted) return aborted();
      if (loadOutcome?.error) return { ok: false, reason: 'render-network', message: loadOutcome.error?.message || 'Не удалось открыть динамическую страницу.' };

      const renderedResult = (normalizedText) => {
        const finalUrl = win.webContents.getURL() || url;
        if (!isAllowedRenderedNavigation(finalUrl, url, renderedExtraOrigins)) {
          return { ok:false, reason:'render-navigation-blocked', message:'Динамический источник попытался перейти на недоверенный адрес.' };
        }
        return { ok:true, text:normalizedText, transport:'rendered-page', status:200, finalUrl };
      };

      const maxTextChars = Math.max(1024, Math.min(
        MAX_RENDERED_TEXT_CHARS,
        Math.floor(Number(sourceConfig.renderedPageMaxTextChars) || MAX_RENDERED_TEXT_CHARS)
      ));
      const renderedTextScript = `(() => { const text = document.body ? document.body.innerText : ""; return text.slice(0, ${maxTextChars}); })()`;
      let lastText = '';
      while (!signal.aborted && win && !win.isDestroyed()) {
        try {
          const readOutcome = await Promise.race([
            win.webContents.executeJavaScript(renderedTextScript, true).then((text) => ({ text })).catch((error) => ({ error })),
            abortPromise
          ]);
          if (readOutcome?.aborted || signal.aborted) return aborted();
          if (readOutcome?.error) return { ok: false, reason: 'render-read-failed', message: readOutcome.error?.message || 'Не удалось прочитать динамическую страницу.' };
          lastText = limitRenderedText(readOutcome?.text || '', maxTextChars);
        } catch (error) {
          return { ok: false, reason: 'render-read-failed', message: error?.message || 'Не удалось прочитать динамическую страницу.' };
        }
        if (lastText) {
          const normalizedText = String(lastText).replace(/\s+/g, ' ').trim();
          if (!readyPattern) return renderedResult(normalizedText);
          readyPattern.lastIndex = 0;
          if (readyPattern.test(normalizedText)) {
            readyPattern.lastIndex = 0;
            return renderedResult(normalizedText);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return aborted();
    } catch (error) {
      return {
        ok: false,
        reason: signal.aborted ? (context.signal?.aborted ? 'check-timeout' : 'render-timeout') : 'render-network',
        message: signal.aborted ? aborted().message : (error?.message || 'Не удалось открыть динамическую страницу.')
      };
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      if (checkerSession && onWillDownload) checkerSession.removeListener('will-download', onWillDownload);
      if (win && !win.isDestroyed()) win.destroy();
    }
  }

  return { requestSignal, fetchHttps, readResponseTextLimited, fetchRemoteText, fetchRenderedPageText };
}

module.exports = { createTransport, MAX_REMOTE_TEXT_BYTES, MAX_HTTPS_REDIRECTS, shouldBlockRenderedResource, usesLightRenderedResourcePolicy };
