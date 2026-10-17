'use strict';

const { stripHtmlToText, formatSourceVersion, parsePublishedDate, parsePublishedDateFromVersion, extractVersionFromFilename } = require('./parsers');

function createOfficialAdapters({ net, execFileAsync, userAgent, requestSignal, fetchHttps, fetchRemoteText, fetchRenderedPageText, platform = process.platform }) {
  const USER_AGENT = userAgent;
  async function checkOfficialPageDate(program, sourceConfig = {}, context = {}) {
    const source = program?.versionSource || {};
    const urls = Array.isArray(source.urls) && source.urls.length ? source.urls : (source.url ? [source.url] : []);
    if (!urls.length || urls.some((u) => !/^https:\/\//i.test(u))) return { ok: false, reason: 'https-required' };
    if (!source.publishedAtPattern) return { ok: false, reason: 'missing-published-date-pattern', message: 'Для страницы не настроено правило поиска даты.' };

    let dateRegex;
    try {
      dateRegex = new RegExp(source.publishedAtPattern, source.publishedAtPatternFlags || 'i');
    } catch {
      return { ok: false, reason: 'invalid-published-date-pattern' };
    }

    let lastFailure = null;
    const requestConfig = {
      ...sourceConfig,
      ...(Number.isFinite(Number(source.timeoutMs)) ? { timeoutMs: Number(source.timeoutMs) } : {}),
      ...(Number.isFinite(Number(source.renderedPageTimeoutMs)) ? { renderedPageTimeoutMs: Number(source.renderedPageTimeoutMs) } : {}),
      ...(Number.isFinite(Number(source.renderedPagePollMs)) ? { renderedPagePollMs: Number(source.renderedPagePollMs) } : {}),
      ...(source.disableCurlFallback === true ? { disableCurlFallback: true } : {}),
      headers: { ...(sourceConfig.headers || {}), ...(source.headers || {}) }
    };

    const resultFromMatch = (match, fetched, url, type = 'official-page-date') => {
      const rawDate = match[1] || match[0];
      const parsedPublished = parsePublishedDate(rawDate, source.publishedAtFormat || 'date');
      if (!parsedPublished.publishedAt && !source.fallbackPublishedAt) return null;
      return {
        ok: true,
        sourceId: program.versionSource.sourceId,
        version: null,
        rawVersion: null,
        publishedAt: parsedPublished.publishedAt || source.fallbackPublishedAt || null,
        publishedAtText: parsedPublished.publishedAtText || source.fallbackPublishedAtText || null,
        htmlUrl: fetched.finalUrl || url,
        transport: fetched.transport,
        rule: { type, url }
      };
    };

    const configuredDateFallback = () => {
      if (!source.fallbackPublishedAt && !source.fallbackPublishedAtText) return null;
      return {
        ok: true,
        sourceId: source.sourceId,
        version: null,
        rawVersion: null,
        publishedAt: source.fallbackPublishedAt || null,
        publishedAtText: source.fallbackPublishedAtText || null,
        htmlUrl: program.website || source.renderedPageUrl || urls[0] || null,
        transport: 'configured-fallback',
        fallback: true,
        configuredFallback: true,
        verification: 'configured-fallback',
        rule: { type: 'official-page-date-fallback' }
      };
    };

    if (source.renderedPageUrl) {
      if (!/^https:\/\//i.test(source.renderedPageUrl)) return { ok: false, reason: 'https-required' };
      const rendered = await fetchRenderedPageText(source.renderedPageUrl, requestConfig, context, dateRegex);
      if (rendered.ok) {
        dateRegex.lastIndex = 0;
        const match = String(rendered.text || '').match(dateRegex);
        if (match) {
          const parsed = resultFromMatch(match, rendered, source.renderedPageUrl, 'official-page-date-rendered');
          if (parsed) return parsed;
          lastFailure = { reason: 'invalid-published-date', message: 'Дата найдена, но не удалось преобразовать её в дату.' };
        } else {
          lastFailure = { reason: 'published-date-not-found', message: 'На динамической странице не удалось найти дату обновления по настроенному правилу.' };
        }
      } else {
        lastFailure = { reason: rendered.reason, message: rendered.message };
      }

      // A rendered page is configured only for data that appears after JavaScript.
      // If it cannot be verified, return the explicit saved value immediately rather
      // than spending the remaining source budget on raw HTML that cannot contain it.
      const fallback = configuredDateFallback();
      if (fallback) return fallback;
    }

    for (const url of urls) {
      try {
        const fetched = await fetchRemoteText(url, requestConfig, context);
        if (!fetched.ok) { lastFailure = { reason: fetched.reason, message: fetched.message }; continue; }
        const text = stripHtmlToText(fetched.text);
        dateRegex.lastIndex = 0;
        const match = text.match(dateRegex);
        if (!match) { lastFailure = { reason: 'published-date-not-found', message: 'На странице не удалось найти дату обновления по настроенному правилу.' }; continue; }
        const parsed = resultFromMatch(match, fetched, url);
        if (!parsed) {
          lastFailure = { reason: 'invalid-published-date', message: 'Дата найдена, но не удалось преобразовать её в дату.' };
          continue;
        }
        return parsed;
      } catch (error) {
        lastFailure = { reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', message: error?.name === 'TimeoutError' ? 'Таймаут страницы.' : (error?.message || 'Сетевая ошибка.') };
      }
    }

    const fallback = configuredDateFallback();
    if (fallback) return fallback;
    return { ok:false, ...(lastFailure || { reason:'published-date-not-found', message:'Не удалось определить дату обновления.' }) };
  }

  async function checkOfficialPage(program, sourceConfig = {}, context = {}) {
    const source = program?.versionSource || {};
    const urls = Array.isArray(source.urls) && source.urls.length ? source.urls : (source.url ? [source.url] : []);
    if (!urls.length || urls.some((u) => !/^https:\/\//i.test(u))) return { ok: false, reason: 'https-required' };
    const pattern = source.versionPattern;
    if (!pattern) return { ok: false, reason: 'missing-version-pattern', message: 'Для официальной страницы не настроено правило поиска версии.' };

    let regex;
    let renderedReadyRegex;
    try {
      const flagSet = new Set(String(source.versionPatternFlags || 'im').split(''));
      flagSet.add('g');
      regex = new RegExp(pattern, [...flagSet].join(''));
      const readyFlags = [...flagSet].filter((flag) => flag !== 'g').join('');
      renderedReadyRegex = new RegExp(pattern, readyFlags);
    } catch { return { ok: false, reason: 'invalid-version-pattern' }; }

    let lastFailure = null;
    const requestConfig = {
      ...sourceConfig,
      ...(Number.isFinite(Number(source.timeoutMs)) ? { timeoutMs: Number(source.timeoutMs) } : {}),
      ...(Number.isFinite(Number(source.renderedPageTimeoutMs)) ? { renderedPageTimeoutMs: Number(source.renderedPageTimeoutMs) } : {}),
      ...(Number.isFinite(Number(source.renderedPagePollMs)) ? { renderedPagePollMs: Number(source.renderedPagePollMs) } : {}),
      ...(source.disableCurlFallback === true ? { disableCurlFallback: true } : {}),
      headers: { ...(sourceConfig.headers || {}), ...(source.headers || {}) }
    };

    const attempts = [];
    if (source.renderedPageUrl) {
      if (!/^https:\/\//i.test(source.renderedPageUrl)) return { ok: false, reason: 'https-required' };
      attempts.push({ url: source.renderedPageUrl, rendered: true });
    }
    for (const url of urls) attempts.push({ url, rendered: false });

    for (const attempt of attempts) {
      const { url, rendered } = attempt;
      try {
        const fetched = rendered
          ? await fetchRenderedPageText(url, requestConfig, context, renderedReadyRegex)
          : await fetchRemoteText(url, requestConfig, context);
        if (!fetched.ok) { lastFailure = { reason: fetched.reason, message: fetched.message }; continue; }
        const text = stripHtmlToText(fetched.text);
        regex.lastIndex = 0;
        const matches = [...text.matchAll(regex)];
        if (!matches.length) {
          if (source.fallbackOnParseMiss === true && source.fallbackVersion) {
            return {
              ok: true,
              sourceId: source.sourceId,
              version: source.fallbackVersion,
              rawVersion: source.fallbackVersion,
              publishedAt: source.fallbackPublishedAt || null,
              publishedAtText: source.fallbackPublishedAtText || null,
              htmlUrl: fetched.finalUrl || url,
              transport: `${fetched.transport || 'network'}-configured-fallback`,
              fallback: true,
              configuredFallback: true,
              verification: 'configured-fallback',
              rule: { type:'official-page-fallback-parse-miss', url }
            };
          }
          lastFailure = { reason:'version-not-found', message:'На странице не удалось найти версию по настроенному правилу.' }; continue;
        }
        const candidates = matches.map((m) => ({ match: m, version: formatSourceVersion(m[1] || m[0], source.versionFormat, m) })).filter((item) => item.version);
        if (!candidates.length) {
          if (source.fallbackOnParseMiss === true && source.fallbackVersion) {
            return {
              ok: true,
              sourceId: source.sourceId,
              version: source.fallbackVersion,
              rawVersion: source.fallbackVersion,
              publishedAt: source.fallbackPublishedAt || null,
              publishedAtText: source.fallbackPublishedAtText || null,
              htmlUrl: fetched.finalUrl || url,
              transport: `${fetched.transport || 'network'}-configured-fallback`,
              fallback: true,
              configuredFallback: true,
              verification: 'configured-fallback',
              rule: { type:'official-page-fallback-parse-miss', url }
            };
          }
          lastFailure = { reason:'empty-version', message:'Найдена строка, но версия оказалась пустой.' }; continue;
        }
        let selected = candidates[0];
        if (source.versionPick === 'highest') {
          const compare = (a, b) => {
            const pa = a.version.match(/\d+/g)?.map(Number) || [];
            const pb = b.version.match(/\d+/g)?.map(Number) || [];
            const len = Math.max(pa.length, pb.length);
            for (let i = 0; i < len; i += 1) { const x = pa[i] ?? 0; const y = pb[i] ?? 0; if (x !== y) return x - y; }
            return 0;
          };
          for (const item of candidates.slice(1)) if (compare(item, selected) > 0) selected = item;
        }
        const version = selected.version;
        const dateMatch = source.publishedAtPattern ? text.match(new RegExp(source.publishedAtPattern, source.publishedAtPatternFlags || 'i')) : null;
        const matchGroup = Number(source.publishedAtMatchGroup);
        const rawDate = Number.isInteger(matchGroup) && matchGroup > 0
          ? (selected.match?.[matchGroup] || null)
          : (dateMatch?.[1] || dateMatch?.[0] || null);
        let parsedPublished = parsePublishedDate(rawDate, source.publishedAtFormat || 'date');
        if (!parsedPublished.publishedAt && source.publishedAtFromVersion) {
          parsedPublished = parsePublishedDateFromVersion(version, source.publishedAtFromVersion);
        }
        return { ok: true, sourceId: program.versionSource.sourceId, version, rawVersion: selected.match[0], publishedAt: parsedPublished.publishedAt || source.fallbackPublishedAt || null, publishedAtText: parsedPublished.publishedAtText || source.fallbackPublishedAtText || null, htmlUrl: source.resultUrl || fetched.finalUrl || url, transport: fetched.transport, rule: { type: rendered ? 'official-page-rendered' : 'official-page', url } };
      } catch (error) {
        lastFailure = { reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', message: error?.name === 'TimeoutError' ? 'Таймаут страницы.' : (error?.message || 'Сетевая ошибка.') };
      }
    }
    if (source.fallbackVersion) {
      return {
        ok: true,
        sourceId: source.sourceId,
        version: source.fallbackVersion,
        rawVersion: source.fallbackVersion,
        publishedAt: source.fallbackPublishedAt || null,
        publishedAtText: source.fallbackPublishedAtText || null,
        htmlUrl: program.website || source.renderedPageUrl || urls[0] || null,
        transport: 'configured-fallback',
        fallback: true,
        configuredFallback: true,
        verification: 'configured-fallback',
        rule: { type: 'official-page-fallback' }
      };
    }
    return { ok:false, ...(lastFailure || { reason:'version-not-found', message:'Не удалось проверить источник.' }) };
  }

  async function checkOfficialDownload(program, sourceConfig = {}, context = {}) {
    const source = program?.versionSource || {};
    const urls = Array.isArray(source.urls) && source.urls.length ? source.urls : (source.url ? [source.url] : []);
    const filenamePattern = source.filenamePattern;
    const timeoutMs = Number(sourceConfig.timeoutMs || 12000);
    const headers = {
      'User-Agent': source.headers?.['User-Agent'] || sourceConfig.headers?.['User-Agent'] || USER_AGENT,
      'Accept': '*/*',
      ...(sourceConfig.headers || {}),
      ...(source.headers || {})
    };
    let lastFailure = null;

    for (const url of urls) {
      try {
        const { response, finalUrl } = await fetchHttps(url, {
          method: 'HEAD',
          headers,
          redirect: 'follow',
          signal: requestSignal(timeoutMs, context.signal)
        });
        const disposition = response.headers.get('content-disposition') || '';
        const location = finalUrl || response.url || url;
        const combined = `${location}\n${disposition}`;
        const version = String(source.versionOverride || '').trim() || extractVersionFromFilename(combined, filenamePattern);
        const headerDateRaw = source.publishedAtFromHeader === 'last-modified'
          ? (response.headers.get('last-modified') || '')
          : '';
        const parsedHeaderDate = headerDateRaw ? parsePublishedDate(headerDateRaw) : { publishedAt: null, publishedAtText: null };
        if (response.ok && version) {
          return {
            ok: true,
            sourceId: source.sourceId,
            version,
            rawVersion: version,
            publishedAt: parsedHeaderDate.publishedAt || source.fallbackPublishedAt || null,
            publishedAtText: parsedHeaderDate.publishedAtText || source.fallbackPublishedAtText || null,
            htmlUrl: program.website || url,
            transport: 'head',
            rule: { type: 'official-download', url, finalUrl: location, publishedAtHeader: headerDateRaw ? 'last-modified' : null }
          };
        }
        lastFailure = { reason: `HTTP ${response.status}`, message: `Официальная загрузка вернула HTTP ${response.status}.` };
      } catch (error) {
        lastFailure = { reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', message: error?.name === 'TimeoutError' ? 'Таймаут официальной загрузки.' : (error?.message || 'Сетевая ошибка.') };
      }

      if (platform === 'win32') {
        try {
          const args = ['-I','-L','-sS','--max-time',String(Math.ceil(timeoutMs/1000)),'--proto','=https','--proto-redir','=https','-A',headers['User-Agent'],url];
          const { stdout = '' } = await execFileAsync('curl.exe', args, { windowsHide: true, maxBuffer: 1024 * 1024, timeout: timeoutMs + 2000, signal: context.signal });
          const version = String(source.versionOverride || '').trim() || extractVersionFromFilename(stdout, filenamePattern);
          const finalUrlMatches = [...stdout.matchAll(/^location:\s*(\S+)/gim)];
          const finalUrl = finalUrlMatches.at(-1)?.[1] || url;
          const statusMatches = [...stdout.matchAll(/^HTTP\/\S+\s+(\d{3})/gim)];
          const finalStatus = Number(statusMatches.at(-1)?.[1] || 0);
          const lastModifiedMatches = [...stdout.matchAll(/^last-modified:\s*(.+)$/gim)];
          const headerDateRaw = source.publishedAtFromHeader === 'last-modified'
            ? String(lastModifiedMatches.at(-1)?.[1] || '').trim()
            : '';
          const parsedHeaderDate = headerDateRaw ? parsePublishedDate(headerDateRaw) : { publishedAt: null, publishedAtText: null };
          if (version && finalStatus >= 200 && finalStatus < 400) {
            return {
              ok: true,
              sourceId: source.sourceId,
              version,
              rawVersion: version,
              publishedAt: parsedHeaderDate.publishedAt || source.fallbackPublishedAt || null,
              publishedAtText: parsedHeaderDate.publishedAtText || source.fallbackPublishedAtText || null,
              htmlUrl: program.website || finalUrl,
              transport: 'curl-head',
              rule: { type: 'official-download', url, finalUrl, publishedAtHeader: headerDateRaw ? 'last-modified' : null }
            };
          }
        } catch (error) {
          lastFailure = { reason: 'curl', message: error?.message || 'Резервная проверка загрузки не удалась.' };
        }
      }
    }

    if (source.fallbackVersion) {
      return {
        ok: true,
        sourceId: source.sourceId,
        version: source.fallbackVersion,
        rawVersion: source.fallbackVersion,
        publishedAt: source.fallbackPublishedAt || null,
        htmlUrl: program.website || urls[0] || null,
        transport: 'configured-fallback',
        fallback: true,
        configuredFallback: true,
        verification: 'configured-fallback',
        rule: { type: 'official-download-fallback' }
      };
    }

    return { ok: false, ...(lastFailure || { reason: 'download-version-not-found', message: 'Не удалось определить версию по официальной загрузке.' }) };
  }

  return { checkOfficialPageDate, checkOfficialPage, checkOfficialDownload };
}

module.exports = { createOfficialAdapters };
