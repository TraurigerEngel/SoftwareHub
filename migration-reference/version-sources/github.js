'use strict';

function createGithubAdapter({ net, userAgent, requestSignal, fetchHttps, readResponseTextLimited, pickGithubRelease, isPreReleaseVersion }) {
  const USER_AGENT = userAgent;
  function buildGithubReleasesUrl(repo, endpoint) {
    const parts = String(repo || '').split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const safeRepo = parts.map((part) => encodeURIComponent(part)).join('/');
    return String(endpoint || 'https://api.github.com/repos/{repo}/releases').replace('{repo}', safeRepo)
      + (String(endpoint || '').includes('?') ? '&' : '?') + 'per_page=30';
  }

  async function checkGithubReleases(program, sourceConfig = {}, context = {}) {
    const source = program?.versionSource;
    if (!source?.repo) return { ok: false, reason: 'missing-repo' };

    const atomResult = await checkGithubAtomReleases(program, sourceConfig, context);
    if (atomResult?.ok) return atomResult;
    if (context.signal?.aborted) return atomResult;

    const endpoint = String(sourceConfig.endpoint || 'https://api.github.com/repos/{repo}/releases');
    const apiUrl = buildGithubReleasesUrl(source.repo, endpoint);
    if (!apiUrl) return { ok: false, reason: 'invalid-repo', message: 'Репозиторий должен быть в формате owner/repository.' };

    try {
      const { response } = await fetchHttps(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': USER_AGENT
        },
        signal: requestSignal(12000, context.signal)
      });

      if (!response.ok) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        if (response.status === 403 || response.status === 429) {
          return {
            ok: false,
            reason: 'rate-limit',
            message: remaining === '0' ? 'Лимит GitHub API исчерпан.' : `GitHub отклонил запрос (${response.status}).`,
            retryAt: reset ? Number(reset) * 1000 : null,
            atomError: atomResult?.message || null
          };
        }
        if (response.status === 404) return { ok: false, reason: 'not-found', message: 'Репозиторий или релизы не найдены.' };
        if (response.status === 401) return { ok: false, reason: 'unauthorized', message: 'GitHub требует авторизацию.' };
        if (response.status >= 500) return { ok: false, reason: 'github-server', message: `GitHub вернул ошибку ${response.status}.` };
        return { ok: false, reason: `HTTP ${response.status}`, message: `GitHub вернул HTTP ${response.status}.` };
      }

      const releases = JSON.parse(await readResponseTextLimited(response, 2 * 1024 * 1024));
      if (!Array.isArray(releases)) return { ok: false, reason: 'invalid-response', message: 'GitHub вернул неожиданный формат данных.' };

      const sourcePolicy = sourceConfig.defaultPolicy || {};
      const programPolicy = program?.versionSource?.releasePolicy || {};
      const policy = { ...sourcePolicy, ...programPolicy };
      if (policy.includePrerelease === undefined) policy.includePrerelease = false;

      const selected = pickGithubRelease(releases, policy);
      if (!selected) return { ok: false, reason: 'no-release', message: 'Подходящий релиз по правилам этой программы не найден.' };

      const release = selected.release;
      return {
        ok: true,
        sourceId: 'github-releases',
        version: selected.version || release.tag_name || release.name || null,
        rawVersion: release.tag_name || release.name || null,
        publishedAt: release.published_at || source.fallbackPublishedAt || null,
        htmlUrl: release.html_url || program.website,
        prerelease: Boolean(release.prerelease),
        rule: { selection: policy.selection || 'highest-version', versionField: policy.versionField || 'tag_name', includePrerelease: Boolean(policy.includePrerelease) }
      };
    } catch (error) {
      if (context.signal?.aborted) return { ok: false, reason: 'check-timeout', message: 'Проверка источника была остановлена по таймауту.' };
      const message = error?.name === 'TimeoutError' ? 'Таймаут запроса к GitHub API.' : (error?.message || 'Сетевая ошибка.');
      return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', message, atomError: atomResult?.message || null };
    }
  }


  function buildGithubAtomUrl(repo, endpoint) {
    const parts = String(repo || '').split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const safeRepo = parts.map((part) => encodeURIComponent(part)).join('/');
    return String(endpoint || 'https://github.com/{repo}/releases.atom').replace('{repo}', safeRepo);
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'");
  }

  function parseGithubAtomEntries(xml) {
    const entries = [];
    const blocks = String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    for (const block of blocks) {
      const text = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? decodeXml(m[1].trim()) : '';
      };
      const linkMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
      const title = text('title');
      const updated = text('updated');
      const published = text('published');
      const link = linkMatch ? decodeXml(linkMatch[1]) : '';
      const tagFromLink = decodeURIComponent((link.match(/\/releases\/tag\/([^/?#]+)/i) || [,''])[1] || '');
      const rawTag = tagFromLink || title;
      if (!rawTag) continue;
      entries.push({
        tag_name: rawTag,
        name: title || rawTag,
        published_at: published || null,
        created_at: updated || null,
        html_url: link || null,
        prerelease: isPreReleaseVersion(rawTag),
        draft: false
      });
    }
    return entries;
  }

  async function checkGithubAtomReleases(program, sourceConfig = {}, context = {}) {
    const source = program?.versionSource;
    if (!source?.repo) return { ok: false, reason: 'missing-repo' };

    const atomUrl = buildGithubAtomUrl(source.repo, sourceConfig.atomEndpoint);
    if (!atomUrl) return { ok: false, reason: 'invalid-repo', message: 'Репозиторий должен быть в формате owner/repository.' };

    try {
      const { response } = await fetchHttps(atomUrl, {
        headers: {
          'Accept': 'application/atom+xml, application/xml, text/xml, */*',
          'User-Agent': USER_AGENT
        },
        signal: requestSignal(12000, context.signal)
      });

      if (!response.ok) {
        return { ok: false, reason: `atom-http-${response.status}`, message: `GitHub Releases Atom вернул HTTP ${response.status}.` };
      }

      const xml = await readResponseTextLimited(response, 2 * 1024 * 1024);
      const releases = parseGithubAtomEntries(xml);
      if (!releases.length) return { ok: false, reason: 'atom-empty', message: 'GitHub Releases Atom не вернул релизы.' };

      const sourcePolicy = sourceConfig.defaultPolicy || {};
      const programPolicy = program?.versionSource?.releasePolicy || {};
      const policy = { ...sourcePolicy, ...programPolicy };
      if (policy.includePrerelease === undefined) {
        policy.includePrerelease = false;
      }

      const selected = pickGithubRelease(releases, policy);
      if (!selected) {
        return { ok: false, reason: 'no-release', message: 'Подходящий релиз по правилам этой программы не найден.' };
      }

      const release = selected.release;
      return {
        ok: true,
        sourceId: 'github-releases',
        transport: 'github-atom',
        version: selected.version || release.tag_name || release.name || null,
        rawVersion: release.tag_name || release.name || null,
        publishedAt: release.published_at || source.fallbackPublishedAt || null,
        htmlUrl: release.html_url || program.website,
        prerelease: Boolean(release.prerelease),
        rule: {
          selection: policy.selection || 'highest-version',
          versionField: policy.versionField || 'tag_name',
          includePrerelease: Boolean(policy.includePrerelease)
        }
      };
    } catch (error) {
      if (context.signal?.aborted) return { ok: false, reason: 'check-timeout', message: 'Проверка источника была остановлена по таймауту.' };
      const message = error?.name === 'TimeoutError' ? 'Таймаут запроса к GitHub Releases.' : (error?.message || 'Сетевая ошибка.');
      return { ok: false, reason: error?.name === 'TimeoutError' ? 'atom-timeout' : 'atom-network', message };
    }
  }

  return { checkGithubReleases, parseGithubAtomEntries, buildGithubReleasesUrl, buildGithubAtomUrl };
}

module.exports = { createGithubAdapter };
