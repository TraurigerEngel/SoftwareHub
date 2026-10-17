'use strict';

const { createTransport } = require('./transport');
const { createGithubAdapter } = require('./github');
const { createOfficialAdapters } = require('./official');

function createVersionSourceService({
  BrowserWindow,
  net,
  execFileAsync,
  loadSources,
  userAgent,
  maxRenderedTextChars,
  versionCheckHardTimeoutMs = 10000,
  pickGithubRelease,
  isPreReleaseVersion,
  isAllowedRenderedNavigation,
  denyAllSessionPermissions,
  limitRenderedText
}) {
  const transport = createTransport({
    BrowserWindow,
    net,
    execFileAsync,
    isAllowedRenderedNavigation,
    denyAllSessionPermissions,
    limitRenderedText,
    userAgent,
    maxRenderedTextChars
  });

  const github = createGithubAdapter({
    net,
    userAgent,
    requestSignal: transport.requestSignal,
    fetchHttps: transport.fetchHttps,
    readResponseTextLimited: transport.readResponseTextLimited,
    pickGithubRelease,
    isPreReleaseVersion
  });

  const official = createOfficialAdapters({
    net,
    execFileAsync,
    userAgent,
    requestSignal: transport.requestSignal,
    fetchHttps: transport.fetchHttps,
    fetchRemoteText: transport.fetchRemoteText,
    fetchRenderedPageText: transport.fetchRenderedPageText
  });

  async function checkDotnetOfficial(program, _sourceConfig = {}, context = {}) {
    const source = program?.versionSource || {};
    const pseudo = { ...program, versionSource: { ...source } };
    return official.checkOfficialPage(pseudo, loadSources()['dotnet-official'] || {}, context);
  }

  const handlers = {
    'github-releases': github.checkGithubReleases,
    'official-page': official.checkOfficialPage,
    'official-page-date': official.checkOfficialPageDate,
    'official-download': official.checkOfficialDownload,
    'dotnet-official': checkDotnetOfficial
  };

  function configuredVersionFallback(program, sourceConfig = {}) {
    const source = program?.versionSource || {};
    if (!source.fallbackVersion) return null;
    return {
      ok: true,
      sourceId: source.sourceId || sourceConfig.adapter || null,
      version: source.fallbackVersion,
      rawVersion: source.fallbackVersion,
      publishedAt: source.fallbackPublishedAt || null,
      publishedAtText: source.fallbackPublishedAtText || null,
      htmlUrl: program.website || source.url || source.urls?.[0] || null,
      transport: 'configured-fallback-timeout',
      fallback: true,
      configuredFallback: true,
      verification: 'configured-fallback',
      rule: { type: 'configured-fallback-timeout' }
    };
  }

  async function checkVersionSource(program, maxTimeoutMs = null) {
    const sourceId = program?.versionSource?.sourceId || program?.versionSource?.type;
    if (!sourceId) return { ok: false, reason: 'missing-source' };

    const sources = loadSources();
    const sourceConfig = sources[sourceId];
    if (!sourceConfig) return { ok: false, reason: 'unknown-source', sourceId };
    if (!sourceConfig.adapter) return { ok: false, reason: 'manual-source', sourceId };

    const handler = handlers[sourceConfig.adapter];
    if (!handler) return { ok: false, reason: 'unsupported-adapter', sourceId, adapter: sourceConfig.adapter };

    const configuredTimeoutMs = Math.max(500, Number(program?.versionSource?.checkTimeoutMs || sourceConfig.checkTimeoutMs || versionCheckHardTimeoutMs));
    const timeoutMs = Number.isFinite(Number(maxTimeoutMs)) && Number(maxTimeoutMs) > 0
      ? Math.max(500, Math.min(configuredTimeoutMs, Number(maxTimeoutMs)))
      : configuredTimeoutMs;
    const timeoutFallback = configuredVersionFallback(program, sourceConfig);
    const controller = new AbortController();
    let timer = null;
    try {
      return await Promise.race([
        handler(program, sourceConfig, { signal: controller.signal }),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            try { controller.abort(new DOMException('Source check timeout', 'TimeoutError')); } catch { controller.abort(); }
            resolve(
              timeoutFallback || {
                ok: false,
                reason: 'check-timeout',
                message: `Проверка источника превысила ${Math.ceil(timeoutMs / 1000)} с.`
              }
            );
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    checkVersionSource,
    transport,
    github,
    official
  };
}

module.exports = { createVersionSourceService };
