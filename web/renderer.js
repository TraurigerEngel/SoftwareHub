let programs = [];
let sources = {};
let query = '';
let currentPage = 1;
let catalogFilter = 'all';
let programCategoryFilter = 'all';
let programCategoryQuery = '';
let programFilterOpen = false;
const PAGE_SIZE = 20;
let checking = false;
const versionCache = new Map();

const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}

const APP_TIME_ZONE = 'Asia/Yekaterinburg';

function formatDate(iso, withTime = false, timeZone = APP_TIME_ZONE) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const options = withTime
    ? { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone }
    : { day:'2-digit', month:'2-digit', year:'numeric', timeZone };
  return new Intl.DateTimeFormat('ru-RU', options).format(date);
}


function siteHostname(program) {
  try {
    return new URL(program.website || '').hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function sourceId(program) {
  return program.versionSource?.sourceId || program.versionSource?.type || null;
}

function sourceLabel(program) {
  const live = versionCache.get(program.id);
  if (live?.ok && live?.transport === 'winget-community-manifest' &&
      ['adwcleaner', 'afterburner', 'gpu-z', 'nvcleanstall', 'rtss'].includes(program.id)) {
    return 'WinGet (сообщество)';
  }
  const id = sourceId(program);
  return sources[id]?.label || (id === 'github' ? 'GitHub' : 'Не указан');
}

function renderActionButtons(program) {
  const configured = Array.isArray(program.actions) ? program.actions : [];
  const actions = configured.length
    ? configured
    : (program.website ? [{ label: program.type === 'site' ? 'Открыть' : 'Сайт', url: program.website }] : []);
  return actions.slice(0, 3).map((action, index) => {
    const attribute = action.copyText
      ? `data-copy-text="${escapeHtml(action.copyText)}"`
      : `data-open="${escapeHtml(action.url)}"`;
    return `<button class="action ${index === 0 ? 'primary' : ''}" ${attribute}>${escapeHtml(action.label)}</button>`;
  }).join('');
}

function renderRelatedActions(program) {
  const related = Array.isArray(program.relatedActions) ? program.relatedActions.slice(0, 2) : [];
  if (!related.length) return '';
  return `<div class="related-actions" aria-label="Связанные ссылки">${related.map((action) =>
    `<button type="button" class="related-action" data-open="${escapeHtml(action.url)}" title="Открыть ${escapeHtml(action.label)}">${escapeHtml(action.label)}</button>`
  ).join('')}</div>`;
}

function isConfiguredFallbackResult(value) {
  if (!value) return false;
  if (value.configuredFallback === true || value.verification === 'configured-fallback') return true;
  return /configured-fallback/i.test(String(value.transport || ''));
}


function getSourceCheckState(program) {
  if (program.type === 'site') return { key:'site', label:'Сайт', cls:'site' };

  const live = versionCache.get(program.id);
  const sourceConfig = sources[sourceId(program)] || {};
  const sourceAdapter = sourceConfig.adapter || null;
  const manualSource = sourceConfig.type === 'manual' || !sourceAdapter || sourceAdapter === 'official-page-date';

  if (manualSource) return { key:'manual', label:'Ссылка', cls:'manual' };
  if (live?.refreshError || live?.ok === false) return { key:'error', label:'Ошибка', cls:'error' };
  if (isConfiguredFallbackResult(live)) return { key:'reserve', label:'Резерв', cls:'reserve' };
  if (live?.ok && live?.version && live?.checkedAt) {
    return { key:'checked', label: live?.refreshWarning ? 'Проверено ранее' : 'Проверено', cls:'checked' };
  }
  return { key:'unchecked', label:'Не проверено', cls:'unchecked' };
}


function visibleCardSearchText(program) {
  const parts = [program.name];
  if (program.type !== 'site') parts.push(program.programCategory, program.cardSummary);
  const actions = Array.isArray(program.actions) ? program.actions : [];
  const relatedActions = Array.isArray(program.relatedActions) ? program.relatedActions : [];

  if (program.type === 'site') {
    parts.push(program.siteCategory, program.siteSummary, siteHostname(program), ...actions.map((action) => action?.label || ''));
    const live = versionCache.get(program.id);
    const sourceConfig = sources[sourceId(program)] || {};
    const showSiteVersion = program.versionSource?.showOnSiteCard === true && Boolean(sourceConfig.adapter);
    if (showSiteVersion) {
      const siteVersion = live?.ok && live.version ? live.version : (program.versionSource?.fallbackVersion || null);
      if (siteVersion) parts.push(program.versionSource?.versionLabel || 'Последняя версия', siteVersion);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  const live = versionCache.get(program.id);
  const sourceConfig = sources[sourceId(program)] || {};
  const automaticSource = Boolean(sourceConfig.adapter);
  const sourceState = getSourceCheckState(program);
  const showStateBadge = ['reserve', 'error', 'unchecked'].includes(sourceState.key);
  if (showStateBadge) parts.push(sourceState.label);

  const hasLatest = Boolean(live?.ok && live.version);
  const showLatestVersion = program.versionSource?.showLatestVersion !== false;
  const latest = automaticSource && hasLatest ? live.version : null;

  if (showLatestVersion && latest) parts.push('Последняя версия', latest);
  if (program.versionSource?.showSource !== false) parts.push('Источник', sourceLabel(program));

  const isTechnicalVersionNote = program.versionNote && /резервн\s*верси|резервный источник|fallback|сравни/i.test(program.versionNote);
  if (program.versionNote && !isTechnicalVersionNote && !live?.refreshError) parts.push(program.versionNote);
  if (automaticSource && live?.refreshError) parts.push('Проверка не удалась');
  else if (automaticSource && isConfiguredFallbackResult(live)) parts.push('Резервные данные');
  else if (automaticSource && live?.refreshWarning) parts.push('Показан сохранённый результат');

  parts.push(...actions.map((action) => action?.label || ''), ...relatedActions.map((action) => action?.label || ''));
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function visiblePrograms() {
  const q = query.trim().toLowerCase();
  return programs.filter((p) => {
    const matchesType = catalogFilter === 'all'
      || (catalogFilter === 'programs' && p.type !== 'site')
      || (catalogFilter === 'sites' && p.type === 'site');
    if (!matchesType) return false;
    const matchesCategory = programCategoryFilter === 'all'
      || cardCategory(p) === programCategoryFilter;
    if (!matchesCategory) return false;
    return !q || visibleCardSearchText(p).includes(q);
  });
}

function totalPages(count) {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

function renderPagination(totalCount) {
  const pagination = el('pagination');
  if (!pagination) return;
  const pages = totalPages(totalCount);
  currentPage = Math.min(Math.max(currentPage, 1), pages);
  pagination.classList.toggle('hidden', pages <= 1);
  if (pages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  const buttons = [];
  buttons.push(`<button class="page-button" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Предыдущая страница">‹</button>`);
  for (let page = 1; page <= pages; page += 1) {
    buttons.push(`<button class="page-button ${page === currentPage ? 'active' : ''}" data-page="${page}" aria-current="${page === currentPage ? 'page' : 'false'}">${page}</button>`);
  }
  buttons.push(`<button class="page-button" data-page="${currentPage + 1}" ${currentPage === pages ? 'disabled' : ''} aria-label="Следующая страница">›</button>`);
  pagination.innerHTML = `<div class="pagination-controls">${buttons.join('')}</div>`;

  pagination.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => {
    const page = Number(btn.dataset.page);
    if (!Number.isFinite(page) || page < 1 || page > pages || page === currentPage) return;
    currentPage = page;
    renderGrid();
    // Return to the top immediately; navigation has no scroll animation.
    const grid = el('grid');
    if (grid) grid.scrollTop = 0;
  }));
}

function getEmptyStateMessage() {
  const searchText = query.trim();
  if (searchText) return `По запросу «${escapeHtml(searchText)}» ничего не найдено.`;
  if (programCategoryFilter !== 'all') {
    return `В категории «${escapeHtml(programCategoryFilter)}» ничего не найдено.`;
  }
  return 'Ничего не найдено.';
}

function updateTruncatedTitleTooltips(root = document) {
  root.querySelectorAll('.title[data-full-title]').forEach((node) => {
    const fullTitle = node.dataset.fullTitle || node.textContent || '';
    const truncated = node.scrollWidth > node.clientWidth + 1;
    if (truncated) node.title = fullTitle;
    else node.removeAttribute('title');
  });
}

function cardCategory(program) {
  return program.type === 'site' ? program.siteCategory : program.programCategory;
}

function categoryEntriesForCurrentView() {
  const counts = new Map();
  programs.forEach((program) => {
    const matchesType = catalogFilter === 'all'
      || (catalogFilter === 'programs' && program.type !== 'site')
      || (catalogFilter === 'sites' && program.type === 'site');
    if (!matchesType) return;
    const category = cardCategory(program);
    if (!category) return;
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function categoryScopeCopy() {
  if (catalogFilter === 'programs') {
    return { title:'Категории программ', summary:'Все категории программ', allLabel:'Все программы' };
  }
  if (catalogFilter === 'sites') {
    return { title:'Категории сайтов', summary:'Все категории сайтов', allLabel:'Все сайты' };
  }
  return { title:'Категории каталога', summary:'Все категории каталога', allLabel:'Весь каталог' };
}

function renderProgramFilter() {
  const wrap = el('programFilterWrap');
  const button = el('programFilterBtn');
  const popover = el('programFilterPopover');
  const options = el('programFilterOptions');
  const label = el('programFilterLabel');
  const title = el('programFilterTitle');
  const summary = el('programFilterSummary');
  if (!wrap || !button || !popover || !options || !label || !title || !summary) return;

  const available = programs.length > 0;
  wrap.classList.toggle('hidden', !available);
  const active = programCategoryFilter !== 'all';
  const scopeCopy = categoryScopeCopy();
  button.classList.toggle('active', active);
  button.setAttribute('aria-expanded', String(programFilterOpen && available));
  label.textContent = active ? programCategoryFilter : 'Категории';
  title.textContent = scopeCopy.title;
  summary.textContent = active ? `Выбрано: ${programCategoryFilter}` : scopeCopy.summary;
  popover.setAttribute('aria-label', scopeCopy.title);
  popover.classList.toggle('hidden', !(programFilterOpen && available));

  const categorySearch = programCategoryQuery.trim().toLowerCase();
  const entries = categoryEntriesForCurrentView().filter((entry) => !categorySearch || entry.name.toLowerCase().includes(categorySearch));
  const totalCards = programs.filter((program) => catalogFilter === 'all'
    || (catalogFilter === 'programs' && program.type !== 'site')
    || (catalogFilter === 'sites' && program.type === 'site')).length;
  const allActive = programCategoryFilter === 'all';
  const html = [
    `<button type="button" class="program-filter-option ${allActive ? 'active' : ''}" data-program-category-filter="all" aria-pressed="${allActive}"><span>${escapeHtml(scopeCopy.allLabel)}</span><span class="program-filter-option-count">${totalCards}</span></button>`
  ];
  if (entries.length) {
    html.push(...entries.map((entry) => {
      const isActive = entry.name === programCategoryFilter;
      return `<button type="button" class="program-filter-option ${isActive ? 'active' : ''}" data-program-category-filter="${escapeHtml(entry.name)}" aria-pressed="${isActive}"><span>${escapeHtml(entry.name)}</span><span class="program-filter-option-count">${entry.count}</span></button>`;
    }));
  } else {
    html.push('<div class="program-filter-empty">Категории не найдены.</div>');
  }
  options.innerHTML = html.join('');
  options.querySelectorAll('[data-program-category-filter]').forEach((option) => option.addEventListener('click', () => {
    setProgramCategoryFilter(option.dataset.programCategoryFilter);
  }));
}

function closeProgramFilter() {
  programFilterOpen = false;
  renderProgramFilter();
}

function setProgramCategoryFilter(category) {
  const valid = category === 'all' || categoryEntriesForCurrentView().some((entry) => entry.name === category);
  if (!valid) return;
  programCategoryFilter = category;
  programCategoryQuery = '';
  const search = el('programFilterSearch');
  if (search) search.value = '';
  currentPage = 1;
  programFilterOpen = false;
  updateStats();
  renderGrid();
}

function setupProgramCategoryFilter() {
  const wrap = el('programFilterWrap');
  const button = el('programFilterBtn');
  const close = el('programFilterClose');
  const search = el('programFilterSearch');
  if (!wrap || !button || !close || !search) return;

  button.addEventListener('click', () => {
    programFilterOpen = !programFilterOpen;
    renderProgramFilter();
    if (programFilterOpen) requestAnimationFrame(() => search.focus());
  });
  close.addEventListener('click', closeProgramFilter);
  search.addEventListener('input', (event) => {
    programCategoryQuery = event.target.value;
    renderProgramFilter();
    requestAnimationFrame(() => search.focus());
  });
  document.addEventListener('pointerdown', (event) => {
    if (!programFilterOpen || wrap.contains(event.target)) return;
    closeProgramFilter();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && programFilterOpen) closeProgramFilter();
  });
}

// Keep catalog updates instantaneous (pagination, categories, search and refresh).
// Startup/splash motion is managed separately by CSS.
function renderGrid() {
  const fullList = visiblePrograms();
  const pages = totalPages(fullList.length);
  currentPage = Math.min(Math.max(currentPage, 1), pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const list = fullList.slice(start, start + PAGE_SIZE);

  renderPagination(fullList.length);
  const grid = el('grid');
  grid.classList.toggle('empty-results', list.length === 0);
  grid.innerHTML = list.length ? list.map((p) => {
    const sourceState = getSourceCheckState(p);
    if (p.type === 'site') {
      const hostname = siteHostname(p);
      const live = versionCache.get(p.id);
      const sourceConfig = sources[sourceId(p)] || {};
      const showSiteVersion = p.versionSource?.showOnSiteCard === true && Boolean(sourceConfig.adapter);
      const siteVersion = showSiteVersion
        ? (live?.ok && live.version ? live.version : (p.versionSource?.fallbackVersion || null))
        : null;
      const siteVersionVerified = Boolean(showSiteVersion && live?.ok && live.version && !isConfiguredFallbackResult(live));
      return `
        <article class="card site-card">
          <div class="card-head">
            <div class="title-wrap"><div class="title" data-full-title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div></div>
            <div class="card-badges">
              <button type="button" class="badge site-category ${programCategoryFilter === p.siteCategory ? 'active' : ''}" data-card-category="${escapeHtml(p.siteCategory)}" aria-pressed="${programCategoryFilter === p.siteCategory}" title="Показать категорию «${escapeHtml(p.siteCategory)}»">${escapeHtml(p.siteCategory)}</button>
            </div>
          </div>
          <div class="site-info">
            <div class="site-summary" title="${escapeHtml(p.siteSummary)}">${escapeHtml(p.siteSummary)}</div>
            ${showSiteVersion && siteVersion ? `
              <div class="site-version-lines">
                ${siteVersion ? `<div class="version-line"><span>${escapeHtml(p.versionSource?.versionLabel || 'Последняя версия')}</span><span class="version-value ${siteVersionVerified ? 'live-version' : ''}">${escapeHtml(siteVersion)}</span></div>` : ''}
              </div>` : ''}
            ${hostname ? `<div class="site-domain" title="${escapeHtml(hostname)}">${escapeHtml(hostname)}</div>` : ''}
          </div>
          <div class="actions">${renderActionButtons(p)}</div>
        </article>`;
    }

    const live = versionCache.get(p.id);
    const formatOptionalDate = (value, withTime = false) => {
      if (!value) return null;
      const formatted = formatDate(value, withTime);
      return formatted === '—' ? null : formatted;
    };
    const checkedAt = live?.checkedAt ? formatOptionalDate(live.checkedAt, true) : null;
    const showStateBadge = ['reserve', 'error', 'unchecked'].includes(sourceState.key);
    const stateBadge = showStateBadge ? `<div class="badge ${sourceState.cls}" title="Состояние онлайн-источника">${escapeHtml(sourceState.label)}</div>` : '';
    const sourceMetaTitle = checkedAt ? `${sourceLabel(p)} · Проверено: ${checkedAt}` : sourceLabel(p);
    const sourceConfig = sources[sourceId(p)] || {};
    const automaticSource = Boolean(sourceConfig.adapter);
    const hasLatest = Boolean(live?.ok && live.version);
    const hasVerifiedLatest = Boolean(hasLatest && !isConfiguredFallbackResult(live));
    const showLatestVersion = p.versionSource?.showLatestVersion !== false;
    const showSource = p.versionSource?.showSource !== false;
    const cardSummary = typeof p.cardSummary === 'string' ? p.cardSummary.trim() : '';
    const latest = automaticSource && hasLatest ? live.version : null;
    const isTechnicalVersionNote = p.versionNote && /резервн\s*верси|резервный источник|fallback|сравни/i.test(p.versionNote);
    const sourceNote = p.versionNote && !isTechnicalVersionNote && !live?.refreshError
      ? `<div class="note-line info" title="${escapeHtml(p.versionNote)}">${escapeHtml(p.versionNote)}</div>` : '';
    const refreshErrorText = live?.refreshError
      ? (live.refreshError.message || live.refreshError.reason || 'Последняя попытка проверки не удалась. Показаны сохранённые данные.') : '';
    const fallbackWarningText = isConfiguredFallbackResult(live)
      ? 'Показаны резервные данные из каталога; источник не подтвердил их при текущей проверке.'
      : (live?.refreshWarning?.message || live?.refreshWarning?.reason || 'Источник не подтвердил новые данные; сохранён последний проверенный результат.');
    const refreshWarning = automaticSource && live?.refreshError
      ? `<div class="note-line warning-line" title="${escapeHtml(`${p.name} · ${sourceLabel(p)} · ${refreshErrorText}`)}">Проверка не удалась</div>`
      : (automaticSource && (isConfiguredFallbackResult(live) || live?.refreshWarning)
        ? `<div class="note-line warning-line" title="${escapeHtml(`${p.name} · ${sourceLabel(p)} · ${fallbackWarningText}`)}">${isConfiguredFallbackResult(live) ? 'Резервные данные' : 'Показан сохранённый результат'}</div>` : '');

    const categoryActive = programCategoryFilter === p.programCategory;
    const categoryBadge = `<button type="button" class="badge program-category ${categoryActive ? 'active' : ''}" data-card-category="${escapeHtml(p.programCategory)}" aria-pressed="${categoryActive}" title="Показать категорию «${escapeHtml(p.programCategory)}»">${escapeHtml(p.programCategory)}</button>`;

    return `
      <article class="card">
        <div class="card-head">
          <div class="title-wrap"><div class="title" data-full-title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div></div>
          <div class="card-badges">${categoryBadge}${stateBadge}</div>
        </div>
        ${cardSummary ? `
          <div class="program-summary-info">
            <div class="program-summary" title="${escapeHtml(cardSummary)}">${escapeHtml(cardSummary)}</div>
            ${automaticSource && showLatestVersion && latest ? `
              <div class="program-summary-version-lines">
                ${showLatestVersion && latest ? `<div class="version-line"><span>Последняя версия</span><span class="version-value ${hasVerifiedLatest ? 'live-version' : ''}">${escapeHtml(latest)}</span></div>` : ''}
              </div>` : ''}
            ${renderRelatedActions(p)}
          </div>` : `
          <div class="versions">
            ${showLatestVersion && latest ? `<div class="version-line"><span>Последняя версия</span><span class="version-value ${hasVerifiedLatest ? 'live-version' : ''}">${escapeHtml(latest)}</span></div>` : ''}
            ${showSource ? `<div class="version-line"><span>Источник</span><span class="version-value source" title="${escapeHtml(sourceMetaTitle)}">${escapeHtml(sourceLabel(p))}</span></div>` : ''}
            ${renderRelatedActions(p)}
            ${refreshWarning || sourceNote}
          </div>`}
        <div class="actions">${renderActionButtons(p)}</div>
      </article>`;
  }).join('') : `<div class="empty-state" role="status">${getEmptyStateMessage()}</div>`;

  requestAnimationFrame(() => updateTruncatedTitleTooltips(grid));

  grid.querySelectorAll('[data-card-category]').forEach((btn) => btn.addEventListener('click', () => {
    setProgramCategoryFilter(btn.dataset.cardCategory);
  }));
  grid.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => window.softwareHub.openExternal(btn.dataset.open)));
  grid.querySelectorAll('[data-copy-text]').forEach((btn) => btn.addEventListener('click', async () => {
    const copied = await window.softwareHub.copyCatalogText(btn.dataset.copyText);
    showToast(copied ? 'Адрес скопирован — вставь его в адресную строку браузера.' : 'Не удалось скопировать адрес.', { kind: copied ? 'info' : 'warning' });
  }));
}

function russianPlural(count, one, few, many = few) {
  const n = Math.abs(Number(count)) % 100;
  const last = n % 10;
  if (n >= 11 && n <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function updateSearchPlaceholder() {
  const search = el('search');
  if (!search) return;
  search.placeholder = catalogFilter === 'programs'
    ? 'Поиск программ…'
    : (catalogFilter === 'sites' ? 'Поиск сайтов…' : 'Поиск программ и сайтов…');
}

function updateStats() {
  updateSearchPlaceholder();
  const totalPrograms = programs.filter((program) => program.type !== 'site');
  const totalSites = programs.filter((program) => program.type === 'site');
  const statItems = [
    { key:'all', value: programs.length, label: 'всего' },
    { key:'programs', value: totalPrograms.length, label: russianPlural(totalPrograms.length, 'программа', 'программы', 'программ') },
    { key:'sites', value: totalSites.length, label: russianPlural(totalSites.length, 'сайт', 'сайта', 'сайтов') }
  ];

  const stats = el('stats');
  stats.innerHTML = statItems.map((item) => {
    const active = item.key === catalogFilter;
    return `<button type="button" class="stat-chip ${active ? 'active' : ''}" data-catalog-filter="${item.key}" aria-pressed="${active}" aria-label="${escapeHtml(`${item.value} ${item.label}`)}">`
      + `<span class="stat-value">${escapeHtml(String(item.value))}</span><span class="stat-label">${escapeHtml(item.label)}</span></button>`;
  }).join('');

  stats.querySelectorAll('[data-catalog-filter]').forEach((button) => button.addEventListener('click', () => {
    const nextFilter = button.dataset.catalogFilter;
    if (!['all', 'programs', 'sites'].includes(nextFilter) || nextFilter === catalogFilter) return;
    catalogFilter = nextFilter;
    programCategoryFilter = 'all';
    programCategoryQuery = '';
    programFilterOpen = false;
    const categorySearch = el('programFilterSearch');
    if (categorySearch) categorySearch.value = '';
    currentPage = 1;
    updateStats();
    renderGrid();
  }));
  renderProgramFilter();
}


function showToast(text, { persistent = false, kind = 'info' } = {}) {
  const node = el('toast');
  if (!node) return;
  clearTimeout(showToast.timer);
  node.textContent = text;
  node.dataset.kind = kind;
  node.classList.remove('hidden');
  if (!persistent) showToast.timer = setTimeout(() => node.classList.add('hidden'), 3600);
}

function hasSavedVersionData() {
  return Array.from(versionCache.values()).some((value) => value?.ok);
}

function offlineNoticeText() {
  return hasSavedVersionData()
    ? 'Нет интернета — показаны сохранённые версии.'
    : 'Нет интернета — онлайн-версии пока недоступны.';
}

async function isInternetAvailable() {
  if (navigator.onLine === false) return false;
  try {
    return Boolean(await window.softwareHub.isInternetAvailable());
  } catch {
    return navigator.onLine !== false;
  }
}


function setLoadingOverlay(visible, { detail = 'Получаем данные из интернета…', count = 'Пожалуйста, подождите…', progress = 0 } = {}) {
  const overlay = el('loadingOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !visible);
  if (!visible) return;
  if (el('loadingTitle')) el('loadingTitle').textContent = 'Обновление онлайн-версий';
  if (el('loadingDetail')) el('loadingDetail').textContent = detail;
  if (el('loadingCount')) el('loadingCount').textContent = count;
  const bar = el('loadingProgressBar');
  if (bar) {
    bar.classList.remove('indeterminate');
    bar.style.width = `${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
  }
}

function serializeCache() {
  return Object.fromEntries(versionCache.entries());
}

async function restoreCache() {
  try {
    const cache = await window.softwareHub.getVersionCache();
    Object.entries(cache || {}).forEach(([id, value]) => {
      const restored = value && typeof value === 'object' ? { ...value } : value;
      if (restored?.ok) {
        restored.refreshError = null;
        restored.refreshWarning = null;
      }
      versionCache.set(id, restored);
    });
  } catch {}
}

const PROGRAM_CHECK_TIMEOUT_MS = 11000;
const REFRESH_BUDGET_MS = 35000;
async function checkProgramWithTimeout(program, timeoutMs = PROGRAM_CHECK_TIMEOUT_MS) {
  let timer = null;
  try {
    return await Promise.race([
      window.softwareHub.checkVersion(program.id, timeoutMs),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok:false, reason:'check-timeout', message:`Проверка источника превысила ${Math.ceil(timeoutMs / 1000)} с.` }), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkVersions({ connectivityChecked = false, programIds = null, background = false } = {}) {
  if (checking) return;

  const requestedIds = Array.isArray(programIds) ? new Set(programIds.map(String)) : null;
  const sourcesToCheck = programs.filter((program) => {
    const id = sourceId(program);
    return Boolean(id && sources[id]?.adapter && sources[id].adapter !== 'official-page-date' && (!requestedIds || requestedIds.has(String(program.id))));
  });
  if (!sourcesToCheck.length) return;

  checking = true;
  el('refreshBtn').disabled = true;
  el('refreshBtn').textContent = background ? '↻ Проверяю…' : '↻ Обновляю…';

  let logId = null;
  let logFailed = false;
  let logFailureReason = '';
  let successful = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let fallbackUsed = 0;
  let deferred = 0;
  let finalStatus = 'completed';
  let finalReason = '';
  let cacheStatus = 'не сохранялся';
  const logEvent = async (event) => {
    if (!logId) return;
    try { await window.softwareHub.appendVersionCheckLog(logId, event); }
    catch (error) {
      logFailed = true;
      logFailureReason = String(error?.message || error || 'ошибка записи');
    }
  };
  // Only the Rust backend writes files. Never pass local filesystem paths from JS.
  try {
    try {
      logId = await window.softwareHub.startVersionCheckLog(background ? 'background' : 'manual', sourcesToCheck.length);
    } catch (error) {
      logFailed = true;
      logFailureReason = String(error?.message || error || 'ошибка создания файла');
    }

    if (navigator.onLine === false) {
      finalStatus = 'offline';
      finalReason = 'Браузер сообщает об отсутствии подключения к интернету';
      if (!background) showToast(offlineNoticeText(), { kind:'warning' });
      return;
    }
    if (!connectivityChecked) {
      if (!background) {
        setLoadingOverlay(true, {
          detail: 'Проверяем подключение к интернету…',
          count: 'Подготовка обновления…',
          progress: 0
        });
      }
      const online = await isInternetAvailable();
      if (!online) {
        finalStatus = 'offline';
        finalReason = 'Windows не подтвердила подключение к интернету';
        if (!background) showToast(offlineNoticeText(), { kind:'warning' });
        return;
      }
    }

    let completed = 0;
    const refreshDeadline = Date.now() + REFRESH_BUDGET_MS;
    const concurrencyLimit = background ? 2 : 3;
    const concurrency = Math.min(concurrencyLimit, Math.max(1, sourcesToCheck.length));
    if (!background) setLoadingOverlay(true, { count:`Проверено 0 из ${sourcesToCheck.length}`, progress:0 });

    const updateProgress = (name = '') => {
      if (background) return;
      setLoadingOverlay(true, {
        detail: name ? `Проверяем: ${name}` : 'Получаем данные из интернета…',
        count: `Проверено ${completed} из ${sourcesToCheck.length}`,
        progress: Math.round((completed / sourcesToCheck.length) * 100)
      });
    };

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < sourcesToCheck.length) {
        const remainingBudgetMs = refreshDeadline - Date.now();
        if (remainingBudgetMs <= 500) {
          const deferredPrograms = sourcesToCheck.slice(nextIndex);
          deferred += deferredPrograms.length;
          nextIndex = sourcesToCheck.length;
          for (const program of deferredPrograms) {
            await logEvent({programId:program.id, status:'deferred', reason:'Общий лимит времени проверки 35 секунд'});
          }
          break;
        }
        const program = sourcesToCheck[nextIndex++];
        const effectiveTimeoutMs = Math.max(500, Math.min(PROGRAM_CHECK_TIMEOUT_MS, remainingBudgetMs));
        let result;
        try { result = await checkProgramWithTimeout(program, effectiveTimeoutMs); }
        catch (error) { result = { ok:false, reason:'client', message:error?.message || 'Неизвестная ошибка.' }; }

        const previous = versionCache.get(program.id);
        const now = new Date().toISOString();
        const configuredFallback = isConfiguredFallbackResult(result);
        const previousVerified = Boolean(previous?.ok && previous?.version && previous.checkedAt && !isConfiguredFallbackResult(previous));
        let eventStatus = 'error';
        let explanation = result?.reason || result?.message || '';

        if (result?.ok && !configuredFallback) {
          const oldVersion = String(previous?.version || '');
          const newVersion = String(result.version || '');
          const reallyChanged = !previousVerified || oldVersion !== newVersion;
          eventStatus = reallyChanged ? 'changed' : 'unchanged';
          explanation = reallyChanged ? (!previousVerified ? 'Впервые подтверждено онлайн' : 'Изменилась версия') : 'Данные совпадают с предыдущей проверкой';
          if (reallyChanged) changed += 1; else unchanged += 1;
          versionCache.set(program.id, { ...result, sourceId:sourceId(program), checkedAt:now, refreshError:null, refreshWarning:null, lastAttemptAt:now });
          successful += 1;
        } else if (result?.ok && configuredFallback) {
          eventStatus = 'fallback';
          explanation ||= 'Источник не подтвердил онлайн-данные; использован резерв';
          if (previousVerified) {
            versionCache.set(program.id, { ...previous, sourceId:sourceId(program), refreshError:null, refreshWarning:{ reason:'configured-fallback', message:'Источник не подтвердил новые данные; сохранён последний проверенный результат.' }, lastAttemptAt:now });
          } else {
            versionCache.set(program.id, { ...result, sourceId:sourceId(program), checkedAt:null, refreshError:null, refreshWarning:null, lastAttemptAt:now });
          }
          fallbackUsed += 1;
        } else if (previousVerified) {
          versionCache.set(program.id, { ...previous, sourceId:sourceId(program), refreshError:result, refreshWarning:null, lastAttemptAt:now });
          failed += 1;
        } else if (previous?.ok && isConfiguredFallbackResult(previous)) {
          eventStatus = 'fallback';
          explanation ||= 'Проверка завершилась ошибкой; оставлены резервные данные';
          versionCache.set(program.id, { ...previous, sourceId:sourceId(program), refreshError:null, refreshWarning:result, lastAttemptAt:now });
          fallbackUsed += 1;
        } else {
          versionCache.set(program.id, { ...result, sourceId:sourceId(program), lastAttemptAt:now });
          failed += 1;
        }

        const current = versionCache.get(program.id);
        await logEvent({
          programId:program.id, status:eventStatus,
          oldVersion:previous?.version ?? '', newVersion:current?.version ?? '',
          transport:result?.transport || '',
          reason:explanation || 'Не удалось получить подтверждённые данные'
        });
        completed += 1;
        updateProgress(program.name);
      }
    };

    await Promise.all(Array.from({ length:concurrency }, () => worker()));
    await window.softwareHub.setVersionCache(serializeCache());
    cacheStatus = 'успешно';
    renderGrid();
    updateStats();
    if (!background) {
      const deferredText = deferred > 0 ? ` • Отложено: ${deferred}` : '';
      showToast(`Обновлено: ${successful} • Резерв: ${fallbackUsed} • Ошибок: ${failed}${deferredText}`);
    }
  } catch (error) {
    finalStatus = 'error';
    finalReason = String(error?.message || error || 'неизвестная ошибка');
    if (!background) showToast(`Проверка завершилась с ошибкой: ${finalReason}`, { kind:'warning' });
  } finally {
    if (logId) {
      try {
        await window.softwareHub.finishVersionCheckLog(logId, {
          status:finalStatus, reason:finalReason, changed, unchanged, fallback:fallbackUsed,
          errors:failed, deferred, cacheStatus
        });
      } catch (error) {
        logFailed = true;
        logFailureReason = String(error?.message || error || 'ошибка завершения файла');
      }
    }
    checking = false;
    el('refreshBtn').disabled = false;
    el('refreshBtn').textContent = '↻ Обновить версии';
    if (!background) setLoadingOverlay(false);
    if (logFailed && !background) showToast(`Не удалось сохранить журнал проверки: ${logFailureReason}`, { kind:'warning' });
  }
}

function setupPageDragScrolling() {
  const grid = el('grid');
  if (!grid) return;
  let dragging = false;
  let moved = false;
  let startY = 0;
  let startScroll = 0;
  const isInteractive = (target) => target instanceof Element && Boolean(target.closest('button, input, textarea, select, a'));
  grid.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isInteractive(event.target)) return;
    dragging = true; moved = false; startY = event.clientY; startScroll = grid.scrollTop;
    grid.setPointerCapture?.(event.pointerId);
  });
  grid.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dy = event.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    if (moved) { event.preventDefault(); grid.scrollTop = startScroll - dy; }
  });
  const stop = () => { dragging = false; };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);
  grid.addEventListener('lostpointercapture', stop);
}

function setupWindowFocusState() {
  const sync = () => document.body.classList.toggle('window-inactive', !document.hasFocus());
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}


function disableContextMenuAndSelection() {
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => {
    if (!(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
  });
}

// Keep the static startup screen until both the catalog and cached data
// have been applied. Switching the gate in one animation frame avoids showing
// intermediate card/stat layouts. It must never depend on online refreshes.
function revealInitialCatalog() {
  requestAnimationFrame(() => {
    document.documentElement.dataset.startup = 'ready';
    // Online version checks are manual: only the Refresh button initiates them.
  });
}

async function init() {
  try {
    const catalog = await window.softwareHub.getCatalog();
    programs = Array.isArray(catalog) ? catalog : (Array.isArray(catalog?.programs) ? catalog.programs : []);
    sources = Array.isArray(catalog) ? {} : (catalog?.sources || {});
    await restoreCache();
    renderGrid();
    updateStats();
    revealInitialCatalog();
  } catch (error) {
    // Catalog failures remain visible and recoverable; don't leave the user
    // with a black or permanently hidden screen.
    programs = [];
    sources = {};
    try {
      renderGrid();
      updateStats();
      showToast(`Не удалось загрузить каталог: ${error?.message || 'неизвестная ошибка'}`, { persistent:true, kind:'warning' });
      revealInitialCatalog();
    } catch {
      // A broken renderer cannot show a safe catalog. Keep the static screen
      // and offer a retry through the watchdog installed by bridge.js.
      const status = el('startupStatus');
      if (status) status.textContent = 'Не удалось подготовить интерфейс. Повторите загрузку.';
      el('startupRetry')?.classList.remove('hidden');
    }
  }
}


setupPageDragScrolling();
setupWindowFocusState();
disableContextMenuAndSelection();
setupProgramCategoryFilter();
el('search').addEventListener('input', (event) => { query = event.target.value; currentPage = 1; renderGrid(); });
el('refreshBtn').title = 'Проверить доступные онлайн-источники версий.';
el('refreshBtn').addEventListener('click', () => checkVersions());
window.addEventListener('resize', () => requestAnimationFrame(() => updateTruncatedTitleTooltips(el('grid'))));
init();
