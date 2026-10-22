import { t } from './i18n.js';

const NAV = [
  ['overview', 'navOverview'],
  ['tree', 'navTree'],
  ['workbench', 'navWorkbench'],
  ['collab', 'navCollab'],
  ['discover', 'navDiscover'],
  ['create', 'navCreate'],
  ['deploy', 'navDeploy'],
  ['market', 'navMarket'],
  ['account', 'navAccount'],
  ['connections', 'navConnections'],
  ['governance', 'navGovernance'],
  ['equity', 'navEquity'],
  ['history', 'navHistory'],
];

const COLLAB_STAGES = ['DRAFT', 'EXPLORING', 'VALIDATING', 'COMMITTED'];
const SCENARIOS = ['PRODUCT', 'RESEARCH', 'HARDWARE'];

const state = {
  locale: localStorage.getItem('forge.locale') || 'zh',
  page: localStorage.getItem('forge.page') || 'overview',
  tenantId: localStorage.getItem('forge.tenant') || 'tenant.demo',
  actorId: localStorage.getItem('forge.actor') || 'user.demo',
  scenarioMode: localStorage.getItem('forge.scenario') || 'PRODUCT',
  account: null,
  intents: [],
  adapters: [],
  editingIntent: null,
  selectedIntentId: localStorage.getItem('forge.intent') || null,
  intentTree: null,
  variants: [],
  judgments: [],
  timeline: [],
  historyFilter: localStorage.getItem('forge.historyFilter') || 'all',
  allocationWeights: { proposer: 38.5, suggester: 32, confirmer: 29.5 },
  allocationsByIntent: {},
  snapshots: [],
  snapshotIntentId: localStorage.getItem('forge.snapshotIntent') || null,
  lifeforms: [],
  selectedLifeformId: localStorage.getItem('forge.lifeform') || null,
  lumenLog: [],
  memories: [],
  memoryModalOpen: false,
  marketOwned: JSON.parse(localStorage.getItem('forge.market') || 'false'),
  connFilter: 'all',
  partnerConfig: null,
  partnerEvents: [],
  sse: { negotiate: null, governance: null },
  roomLogs: { negotiate: [], governance: [] },
};

const el = (id) => document.getElementById(id);
const tt = (key) => t(state.locale, key);

function headers({ idempotencyKey, json } = {}) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-tenant-id': state.tenantId,
    'x-actor-id': state.actorId,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

async function api(method, path, { body, idempotencyKey } = {}) {
  const response = await fetch(path, {
    method,
    headers: headers({ idempotencyKey, json: body !== undefined }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || response.statusText || `HTTP_${response.status}`);
  return json;
}

function toast(message) {
  const node = el('toast');
  node.hidden = false;
  node.textContent = message;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { node.hidden = true; }, 2800);
}

function selectedIntent() {
  return state.intents.find((item) => item.id === state.selectedIntentId) || state.intents[0] || null;
}

function judgmentFor(candidateId) {
  return state.judgments.find((item) => item.candidateId === candidateId) || null;
}

function formatJudgmentMark(judgment) {
  if (!judgment) return '';
  const at = (judgment.occurredAt || '').slice(11, 19) || judgment.occurredAt;
  return `${tt('judgmentBy')} ${judgment.actorId} · ${at} · ${judgment.action}`;
}

async function refreshVariantsAndJudgments() {
  try {
    const catalog = await api('GET', '/v1/forge/variant-candidates');
    state.variants = catalog.candidates || [];
  } catch {
    state.variants = [];
  }
  const intent = selectedIntent();
  if (!intent) {
    state.judgments = [];
    return;
  }
  try {
    const data = await api('GET', `/v1/forge/intents/${encodeURIComponent(intent.id)}/judgments`);
    state.judgments = data.judgments || [];
  } catch {
    state.judgments = [];
  }
}

async function recordJudgment(candidateId, action) {
  const intent = selectedIntent();
  if (!intent) throw new Error(tt('emptyIntents'));
  const judgment = await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/judgments`, {
    body: { candidate_id: candidateId, action },
    idempotencyKey: `judgment:${intent.id}:${candidateId}:${action}`,
  });
  await refreshVariantsAndJudgments();
  return judgment;
}

async function refreshTimeline() {
  const filter = state.historyFilter;
  const intentId = filter === 'selected'
    ? (selectedIntent()?.id || null)
    : (filter !== 'all' ? filter : null);
  const qs = intentId ? `?intent_id=${encodeURIComponent(intentId)}` : '';
  try {
    const data = await api('GET', `/v1/forge/timeline${qs}`);
    state.timeline = data.items || [];
  } catch {
    state.timeline = [];
  }
}

function timelineKindLabel(kind) {
  const key = ({
    CREATED: 'tlCreated',
    UPDATED: 'tlUpdated',
    FROZEN: 'tlFrozen',
    UNFROZEN: 'tlUnfrozen',
    JUDGMENT: 'tlJudgment',
    CONFIRMED: 'tlConfirmed',
    DEPLOYED: 'tlDeployed',
    FEEDBACK: 'tlFeedback',
    SETTLED: 'tlSettled',
    SNAPSHOT: 'tlSnapshot',
    ROLLED_BACK: 'tlRolledBack',
    OTHER: 'tlOther',
  })[kind] || 'tlOther';
  return tt(key);
}

function timelineKindClass(kind) {
  return ({
    CREATED: 'tl-created',
    UPDATED: 'tl-updated',
    FROZEN: 'tl-frozen',
    UNFROZEN: 'tl-unfrozen',
    JUDGMENT: 'tl-judgment',
    CONFIRMED: 'tl-confirmed',
    DEPLOYED: 'tl-deployed',
    FEEDBACK: 'tl-feedback',
    SETTLED: 'tl-settled',
    SNAPSHOT: 'tl-snapshot',
    ROLLED_BACK: 'tl-rolled-back',
    OTHER: 'tl-other',
  })[kind] || 'tl-other';
}

function timelineSummary(item) {
  const p = item.payload || {};
  if (item.kind === 'JUDGMENT') {
    const title = state.locale === 'zh'
      ? (p.candidateTitleZh || p.candidateId || '')
      : (p.candidateTitleEn || p.candidateId || '');
    return `${p.action || ''} · ${title} · ${item.actorId}`;
  }
  if (item.kind === 'CREATED') {
    return `${tt('tlStake')}: ${p.stake ?? '—'} · ${item.actorId}`;
  }
  if (item.kind === 'SETTLED') {
    return `${tt('minted')}: +${p.creditMinted ?? p.minted ?? '—'} · ${item.actorId}`;
  }
  if (item.kind === 'DEPLOYED') {
    return `${p.adapterId || p.jobId || item.eventType || ''} · ${item.actorId}`;
  }
  return `${item.eventType || item.kind} · ${item.actorId}`;
}

const CONSTRAINT_OPS = ['<=', '>=', '<', '>', '=', '~'];

function formatConstraint(c) {
  return c.unit ? `${c.key} ${c.op} ${c.value} ${c.unit}` : `${c.key} ${c.op} ${c.value}`;
}

function constraintsEditorHtml(rows, { idPrefix, editable }) {
  const list = rows.length ? rows : [{ key: '', op: '<=', value: '', unit: '' }];
  return `
    <div class="constraint-editor" id="${idPrefix}-editor" data-editable="${editable ? '1' : '0'}">
      ${list.map((c, i) => `
        <div class="constraint-row" data-idx="${i}">
          <input class="c-key" placeholder="${tt('constraintKey')}" value="${escapeAttr(c.key || '')}" ${editable ? '' : 'disabled'}>
          <select class="c-op" ${editable ? '' : 'disabled'}>
            ${CONSTRAINT_OPS.map((op) => `<option value="${op}" ${c.op === op ? 'selected' : ''}>${op}</option>`).join('')}
          </select>
          <input class="c-value" placeholder="${tt('constraintValue')}" value="${escapeAttr(c.value || '')}" ${editable ? '' : 'disabled'}>
          <input class="c-unit" placeholder="${tt('constraintUnit')}" value="${escapeAttr(c.unit || '')}" ${editable ? '' : 'disabled'}>
          ${editable ? `<button type="button" class="btn btn-ghost c-remove" data-remove="${i}">${tt('removeConstraint')}</button>` : ''}
        </div>`).join('')}
      ${editable ? `<button type="button" class="btn btn-ghost" id="${idPrefix}-add">${tt('addConstraint')}</button>` : ''}
    </div>`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readConstraintsFromEditor(root) {
  if (!root) return [];
  return [...root.querySelectorAll('.constraint-row')].map((row) => {
    const key = row.querySelector('.c-key')?.value.trim() || '';
    const op = row.querySelector('.c-op')?.value || '<=';
    const value = row.querySelector('.c-value')?.value.trim() || '';
    const unit = row.querySelector('.c-unit')?.value.trim() || '';
    return unit ? { key, op, value, unit } : { key, op, value };
  }).filter((c) => c.key && c.value);
}

function bindConstraintEditor(idPrefix) {
  const root = document.getElementById(`${idPrefix}-editor`);
  if (!root || root.dataset.editable !== '1') return;
  el(`${idPrefix}-add`)?.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'constraint-row';
    row.innerHTML = `
      <input class="c-key" placeholder="${tt('constraintKey')}">
      <select class="c-op">${CONSTRAINT_OPS.map((op) => `<option value="${op}">${op}</option>`).join('')}</select>
      <input class="c-value" placeholder="${tt('constraintValue')}">
      <input class="c-unit" placeholder="${tt('constraintUnit')}">
      <button type="button" class="btn btn-ghost c-remove">${tt('removeConstraint')}</button>`;
    row.querySelector('.c-remove')?.addEventListener('click', () => row.remove());
    root.insertBefore(row, el(`${idPrefix}-add`));
  });
  root.querySelectorAll('.c-remove').forEach((btn) => btn.addEventListener('click', () => {
    btn.closest('.constraint-row')?.remove();
  }));
}

async function refreshAccount() {
  try {
    state.account = await api('GET', '/v1/forge/accounts/me');
  } catch {
    state.account = await api('POST', '/v1/forge/accounts', {
      body: { principal_id: state.actorId, opening_balance: 12450 },
      idempotencyKey: `acct:${state.actorId}`,
    });
  }
  el('credit-bal').textContent = String(state.account?.balance ?? '—');
}

async function refreshIntents() {
  const data = await api('GET', '/v1/forge/intents');
  state.intents = data.intents || [];
  if (!state.selectedIntentId && state.intents[0]) {
    state.selectedIntentId = state.intents[0].id;
    localStorage.setItem('forge.intent', state.selectedIntentId);
  }
}

async function refreshAdapters() {
  const data = await api('GET', '/v1/forge/adapters');
  state.adapters = data.adapters || [];
}

function scenarioLabel(scenario) {
  if (scenario === 'RESEARCH') return tt('scenarioResearch');
  if (scenario === 'HARDWARE') return tt('scenarioHardware');
  return tt('scenarioProduct');
}

function stageLabel(stage) {
  if (stage === 'EXPLORING') return tt('stageExploring');
  if (stage === 'VALIDATING') return tt('stageValidating');
  if (stage === 'COMMITTED') return tt('stageCommitted');
  return tt('stageDraft');
}

function treeKindLabel(kind) {
  if (kind === 'CONSTRAINT') return tt('treeKindConstraint');
  if (kind === 'SUCCESS') return tt('treeKindSuccess');
  if (kind === 'BRANCH') return tt('treeKindBranch');
  return tt('treeKindGoal');
}

function treeStatusLabel(status) {
  if (status === 'ALIGNED') return tt('treeStatusAligned');
  if (status === 'CONFLICT') return tt('treeStatusConflict');
  if (status === 'DONE') return tt('treeStatusDone');
  return tt('treeStatusOpen');
}

function nextCollabStage(current) {
  const idx = COLLAB_STAGES.indexOf(current || 'DRAFT');
  if (idx < 0 || idx >= COLLAB_STAGES.length - 1) return null;
  return COLLAB_STAGES[idx + 1];
}

function renderNav() {
  const nav = el('nav');
  nav.innerHTML = `
    <div class="scenario-switch" id="scenario-switch">
      <div class="stat-sub">${tt('scenarioMode')}</div>
      <div class="btn-row scenario-row">
        ${SCENARIOS.map((s) => `
          <button type="button" class="btn ${state.scenarioMode === s ? 'btn-cyan' : 'btn-ghost'} scenario-btn" data-scenario="${s}">
            ${scenarioLabel(s)}
          </button>`).join('')}
      </div>
    </div>
    ${NAV.map(([id, key]) => (
      `<button type="button" class="nav-item${state.page === id ? ' active' : ''}" data-page="${id}">${tt(key)}</button>`
    )).join('')}`;
  nav.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });
  nav.querySelectorAll('[data-scenario]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.scenarioMode = btn.dataset.scenario;
      localStorage.setItem('forge.scenario', state.scenarioMode);
      renderNav();
      renderPage();
    });
  });
}

function applyChromeI18n() {
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = tt(node.getAttribute('data-i18n'));
  });
  el('lang-zh').classList.toggle('active', state.locale === 'zh');
  el('lang-en').classList.toggle('active', state.locale === 'en');
  renderNav();
}

function setHeader(eyebrow, title, sub) {
  el('eyebrow').textContent = eyebrow;
  el('page-title').textContent = title;
  el('page-sub').textContent = sub || '';
}

function navigate(page) {
  closeSse();
  state.page = page;
  localStorage.setItem('forge.page', page);
  el('sidebar').classList.remove('open');
  el('overlay').classList.remove('open');
  applyChromeI18n();
  renderPage();
}

function impactLabel(impact) {
  if (impact === 'high') return tt('impactHigh');
  if (impact === 'med') return tt('impactMed');
  return tt('impactExplore');
}

function reputationSubtext(rep) {
  if (!rep) return tt('reputationUnknown');
  if (rep.topPercent == null) return tt('reputationSampleThin');
  return tt('reputationTop').replace('{n}', String(rep.topPercent));
}

function renderOverview() {
  setHeader(tt('overviewEyebrow'), `${tt('welcome')}, Alex.`, '');
  const active = state.intents.filter((i) => i.status !== 'SETTLED' && i.status !== 'REJECTED');
  const projects = state.intents.slice(0, 5);
  const rep = state.account?.reputation;
  const score = rep?.score ?? '—';
  el('page-title').innerHTML = `<span class="hero-brand">InnoForge</span>`;
  el('page-sub').textContent = `${tt('welcomeBack')}, Alex.`;
  el('content').innerHTML = `
    <div class="grid-3">
      <div class="panel"><div class="stat-label">${tt('activeIntents')}</div><div class="stat-value">${active.length} ${tt('activeCount')}</div></div>
      <div class="panel"><div class="stat-label">${tt('credit')}</div><div class="stat-value cyan">${state.account?.balance ?? '—'}</div><div class="stat-sub">${tt('staked')} ${state.account?.staked ?? 0}</div></div>
      <div class="panel" id="reputation-card"><div class="stat-label">${tt('reputation')}</div><div class="stat-value">${score}</div><div class="stat-sub" style="color:var(--cyan)">${reputationSubtext(rep)}</div></div>
    </div>
    <div class="panel" style="margin-top:0.85rem">
      <div style="display:flex;justify-content:space-between;align-items:center"><h3>${tt('projects')}</h3><a href="#discover" id="to-discover">${tt('discoverMore')}</a></div>
      ${projects.length ? projects.map((p) => `<div class="list-row"><span>${p.statement.slice(0, 48)}${p.statement.length > 48 ? '…' : ''}</span><span class="mono">${p.pxnPath?.taskState || p.status}</span></div>`).join('') : `<p class="empty">${tt('emptyIntents')}</p>`}
    </div>`;
  el('to-discover')?.addEventListener('click', (e) => { e.preventDefault(); navigate('discover'); });
}

function renderWorkbench() {
  const intent = selectedIntent();
  setHeader(tt('workbenchCrumb'), tt('navWorkbench'), tt('workbenchSub'));
  const editing = Boolean(state.editingIntent && intent && state.editingIntent === intent.id);
  const frozen = Boolean(intent?.frozen);
  const canMutate = intent && (intent.status === 'STAKED' || intent.status === 'CONFIRMED');
  const statement = intent?.statement || (state.locale === 'zh'
    ? '为小批量五金件设计模块化支架系统，优化韧性、可循环与人机交互。'
    : 'Design a modular bracket system for small-batch hardware optimizing resilience, circularity, and human interaction.');
  const constraints = intent?.constraints?.length
    ? intent.constraints
    : [];
  const variants = state.variants.filter((v) => judgmentFor(v.id)?.action !== 'REJECT');
  const openCount = variants.filter((v) => !judgmentFor(v.id)).length;
  el('content').innerHTML = `
    <div class="btn-row" style="margin-bottom:0.75rem">
      <span class="badge">${tt('version')} 0.4.2</span>
      <span class="badge cyan">${tt('stakeBadge')} ${intent?.stake ?? state.account?.staked ?? 0}</span>
      <span class="badge cyan">${intent ? intent.status : tt('intentActive')}</span>
      ${intent ? `<span class="badge ${frozen ? '' : 'cyan'}">${frozen ? tt('frozen') : tt('unfrozen')}</span>` : ''}
    </div>
    <div class="workbench">
      <div class="panel">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <h3>${tt('intentCard')}</h3>
          <div class="btn-row">
            ${canMutate && !editing && !frozen ? `<button type="button" class="btn btn-ghost" id="wb-edit">${tt('editIntent')}</button>` : ''}
            ${canMutate && editing ? `<button type="button" class="btn btn-primary" id="wb-save">${tt('saveIntent')}</button>
              <button type="button" class="btn btn-ghost" id="wb-cancel">${tt('cancelEdit')}</button>` : ''}
            ${canMutate && !frozen ? `<button type="button" class="btn btn-warn" id="wb-freeze">${tt('freeze')}</button>` : ''}
            ${canMutate && frozen ? `<button type="button" class="btn btn-cyan" id="wb-unfreeze">${tt('unfreeze')}</button>` : ''}
          </div>
        </div>
        ${frozen ? `<p class="empty">${tt('intentFrozenHint')}</p>` : ''}
        ${editing
    ? `<div class="field"><span>${tt('statement')}</span><textarea id="wb-statement">${statement}</textarea></div>
            <div class="stat-label">${tt('constraints')}</div>
            ${constraintsEditorHtml(constraints.length ? constraints : [{ key: 'mass', op: '<=', value: '180', unit: 'g' }], { idPrefix: 'wb', editable: true })}`
    : `<p style="margin:0.4rem 0 0.8rem;color:#c9d4e8">${statement}</p>
            <div class="stat-label">${tt('constraints')}</div>
            ${constraints.length
      ? `<ul style="margin:0.35rem 0 1rem;padding-left:1.1rem;color:var(--muted);font-size:0.85rem">
                  ${constraints.map((c) => `<li class="mono">${formatConstraint(c)}</li>`).join('')}
                </ul>`
      : `<p class="empty">${tt('noConstraints')}</p>`}`}
        <div class="twin-stage">
          <div><div class="twin-glyph">▣</div><div>${tt('livingTwin')}</div><div class="stat-sub">${tt('livingTwinSub')}</div></div>
        </div>
      </div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3>${tt('variants')} · ${openCount} ${tt('newProposals')}</h3>
          <button type="button" class="btn btn-ghost" id="refresh-var">${tt('refresh')}</button>
        </div>
        ${!intent ? `<p class="empty">${tt('emptyIntents')}</p>` : ''}
        ${intent && !variants.length ? `<p class="empty">${tt('allVariantsJudged')}</p>` : ''}
        ${variants.map((v) => {
    const judgment = judgmentFor(v.id);
    const adopted = judgment?.action === 'ADOPT';
    return `
          <div class="variant">
            <div class="meta">${v.tag} · ${state.locale === 'zh' ? v.titleZh : v.titleEn}</div>
            <div style="font-size:0.84rem;color:var(--muted);margin-bottom:0.45rem">${state.locale === 'zh' ? v.bodyZh : v.bodyEn} · ${impactLabel(v.impact)}</div>
            ${adopted ? `<div class="stat-sub mono" style="margin-bottom:0.45rem">${formatJudgmentMark(judgment)}</div>` : ''}
            <div class="btn-row">
              <button type="button" class="btn btn-cyan" data-adopt="${v.id}" ${adopted || !intent ? 'disabled' : ''}>${adopted ? tt('adopted') : tt('adopt')}</button>
              <button type="button" class="btn btn-ghost" data-reject="${v.id}" ${adopted || !intent ? 'disabled' : ''}>${tt('reject')}</button>
            </div>
          </div>`;
  }).join('')}
      </div>
      <div class="panel chat">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem">
          <h3>${tt('lumen')}</h3>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost" id="memory-open">${tt('memoryManage')}</button>
            <span class="badge cyan">${tt('memory')}</span>
          </div>
        </div>
        <div class="stat-sub">${tt('lumenRole')}</div>
        <div class="bubble">${tt('lumenHello')}</div>
        ${state.lumenLog.map((m) => `<div class="bubble">${m}</div>`).join('')}
        <div class="field" style="margin:0"><textarea id="lumen-input" placeholder="${tt('lumenPlaceholder')}"></textarea></div>
        <button type="button" class="btn btn-primary" id="lumen-send">${tt('sendLumen')}</button>
      </div>
    </div>
    ${state.memoryModalOpen ? memoryModalHtml() : ''}`;
  if (editing) bindConstraintEditor('wb');
  bindMemoryModal(intent);
  el('wb-edit')?.addEventListener('click', () => {
    state.editingIntent = intent.id;
    renderWorkbench();
  });
  el('wb-cancel')?.addEventListener('click', () => {
    state.editingIntent = null;
    renderWorkbench();
  });
  el('wb-save')?.addEventListener('click', async () => {
    try {
      await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intent.id)}`, {
        body: {
          statement: el('wb-statement').value.trim(),
          constraints: readConstraintsFromEditor(document.getElementById('wb-editor')),
        },
        idempotencyKey: `patch:${intent.id}:${Date.now()}`,
      });
      state.editingIntent = null;
      await refreshIntents();
      toast(tt('intentSaved'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  });
  el('wb-freeze')?.addEventListener('click', async () => {
    try {
      await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intent.id)}`, {
        body: { frozen: true },
        idempotencyKey: `freeze:${intent.id}:${Date.now()}`,
      });
      state.editingIntent = null;
      await refreshIntents();
      toast(tt('intentFrozenToast'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  });
  el('wb-unfreeze')?.addEventListener('click', async () => {
    try {
      await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intent.id)}`, {
        body: { frozen: false },
        idempotencyKey: `unfreeze:${intent.id}:${Date.now()}`,
      });
      await refreshIntents();
      toast(tt('intentUnfrozenToast'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  });
  el('content').querySelectorAll('[data-adopt]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const judgment = await recordJudgment(btn.dataset.adopt, 'ADOPT');
      toast(`${tt('adopted')} · ${judgment.actorId}`);
      renderWorkbench();
    } catch (error) { toast(error.message); }
  }));
  el('content').querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await recordJudgment(btn.dataset.reject, 'REJECT');
      toast(tt('rejectedToast'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  }));
  el('refresh-var')?.addEventListener('click', async () => {
    await refreshVariantsAndJudgments();
    toast(tt('judgmentsRefreshed'));
    renderWorkbench();
  });
  el('memory-open')?.addEventListener('click', async () => {
    if (!intent) return toast(tt('memoryNeedIntent'));
    state.memoryModalOpen = true;
    await refreshMemories(intent.id);
    renderWorkbench();
  });
  el('lumen-send')?.addEventListener('click', async () => {
    const text = el('lumen-input').value.trim();
    if (!text) return;
    if (!intent) return toast(tt('memoryNeedIntent'));
    try {
      const memory = await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/memories`, {
        body: { text },
        idempotencyKey: `mem:${intent.id}:${Date.now()}`,
      });
      state.lumenLog.push(text);
      state.lumenLog.push(tt('memoryEcho').replace('{id}', memory.id.slice(0, 18)));
      await refreshMemories(intent.id);
      await refreshIntents();
      toast(tt('memoryCreated'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  });
}

function memoryStatusLabel(status) {
  if (status === 'FORGOTTEN') return tt('memoryForgotten');
  if (status === 'PROMOTED') return tt('memoryPromoted');
  return tt('memoryActive');
}

async function refreshMemories(intentId) {
  if (!intentId) {
    state.memories = [];
    return;
  }
  try {
    const data = await api('GET', `/v1/forge/intents/${encodeURIComponent(intentId)}/memories`);
    state.memories = data.memories || [];
  } catch {
    state.memories = [];
  }
}

function memoryModalHtml() {
  const memories = state.memories || [];
  return `
    <div class="modal-backdrop" id="memory-backdrop">
      <div class="modal-panel" id="memory-modal" role="dialog" aria-modal="true">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem">
          <h3>${tt('memoryModalTitle')}</h3>
          <button type="button" class="btn btn-ghost" id="memory-close">${tt('memoryClose')}</button>
        </div>
        <p class="empty">${tt('memoryModalHint')}</p>
        <div id="memory-list">
          ${memories.length ? memories.map((m) => `
            <div class="list-row memory-row">
              <div>
                <div>${escapeAttr(m.text)}</div>
                <div class="stat-sub">
                  ${memoryStatusLabel(m.status)}
                  ${m.consensus ? ` · ${tt('memoryConsensus')}` : ''}
                  · <span class="mono">${escapeAttr(m.id.slice(0, 18))}</span>
                </div>
              </div>
              <div class="btn-row">
                <button type="button" class="btn btn-warn" data-forget="${escapeAttr(m.id)}" ${m.status !== 'ACTIVE' ? 'disabled' : ''}>${tt('memoryForget')}</button>
                <button type="button" class="btn btn-cyan" data-promote="${escapeAttr(m.id)}" ${m.status !== 'ACTIVE' ? 'disabled' : ''}>${tt('memoryPromote')}</button>
              </div>
            </div>`).join('') : `<p class="empty">${tt('memoryEmpty')}</p>`}
        </div>
      </div>
    </div>`;
}

function bindMemoryModal(intent) {
  el('memory-close')?.addEventListener('click', () => {
    state.memoryModalOpen = false;
    renderWorkbench();
  });
  el('memory-backdrop')?.addEventListener('click', (event) => {
    if (event.target === el('memory-backdrop')) {
      state.memoryModalOpen = false;
      renderWorkbench();
    }
  });
  el('content')?.querySelectorAll('[data-forget]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!intent) return;
    try {
      await api('DELETE', `/v1/forge/intents/${encodeURIComponent(intent.id)}/memories/${encodeURIComponent(btn.dataset.forget)}`, {
        idempotencyKey: `mem-forget:${btn.dataset.forget}`,
      });
      await refreshMemories(intent.id);
      toast(tt('memoryForgetOk'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  }));
  el('content')?.querySelectorAll('[data-promote]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!intent) return;
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/memories/${encodeURIComponent(btn.dataset.promote)}/promote`, {
        body: {},
        idempotencyKey: `mem-promote:${btn.dataset.promote}`,
      });
      await refreshMemories(intent.id);
      await refreshIntents();
      toast(tt('memoryPromoteOk'));
      renderWorkbench();
    } catch (error) { toast(error.message); }
  }));
}

function closeSse() {
  for (const key of Object.keys(state.sse)) {
    state.sse[key]?.close();
    state.sse[key] = null;
  }
}

function appendRoomLog(room, message) {
  state.roomLogs[room] = [...(state.roomLogs[room] || []), message].slice(-80);
  const node = document.getElementById(`room-log-${room}`);
  if (!node) return;
  node.innerHTML = state.roomLogs[room]
    .map((m) => `<div><span style="color:var(--cyan)">${m.actorId}</span> ${m.text}</div>`)
    .join('');
  node.scrollTop = node.scrollHeight;
}

function connectSse(room) {
  state.sse[room]?.close();
  const url = `/v1/forge/sse/${room}`;
  // EventSource cannot set custom headers — pass tenant/actor as query for browser SSE.
  const qs = new URLSearchParams({
    'x-tenant-id': state.tenantId,
    'x-actor-id': state.actorId,
  });
  const source = new EventSource(`${url}?${qs.toString()}`);
  state.sse[room] = source;
  source.addEventListener('message', (event) => {
    try {
      appendRoomLog(room, JSON.parse(event.data));
    } catch { /* ignore */ }
  });
  source.onerror = () => { /* keep reconnecting via browser */ };
}

async function refreshPartner() {
  const data = await api('GET', '/v1/forge/partner/events');
  state.partnerEvents = data.events || [];
  state.partnerConfig = data.config || null;
}

function partnerEventsHtml() {
  if (!state.partnerEvents.length) return `<p class="empty">—</p>`;
  return `<div class="event-feed">${state.partnerEvents.map((e) => `
    <div class="row">
      <span class="${e.status === 'FAILED' ? 'pill-fail' : 'pill-ok'}">${e.status}</span>
      <span>${e.direction} · ${e.kind}</span>
      <span class="mono">${e.at.slice(11, 19)}</span>
    </div>`).join('')}</div>`;
}

async function mountR3f(kind, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="loading">${tt('loading3d')}</div>`;
  try {
    const mod = await import('/forge/r3f-scenes.js');
    container.innerHTML = '';
    if (kind === 'collab') {
      mod.mountCollabScene(container, {
        intent: state.locale === 'zh' ? '意图' : 'Intent',
        twin: state.locale === 'zh' ? '孪生' : 'Twin',
        agent: 'Agent',
        deploy: state.locale === 'zh' ? '部署' : 'Deploy',
      });
    } else {
      mod.mountLifeformScene(container, { spinning: true });
    }
  } catch (error) {
    container.innerHTML = `<div class="loading">${error.message}</div>`;
  }
}

function renderCollab() {
  setHeader(tt('navCollab'), tt('collabTitle'), tt('collabSub'));
  const intent = selectedIntent();
  const stage = intent?.collabStage || 'DRAFT';
  const next = nextCollabStage(stage);
  el('content').innerHTML = `
    <div class="panel" id="collab-stage-panel">
      <h3>${tt('collabStageTitle')} · ${scenarioLabel(intent?.scenario || state.scenarioMode)}</h3>
      <p class="empty">${tt('collabStageHint')}</p>
      <div class="stage-rail collab-stage-rail">
        ${COLLAB_STAGES.map((s) => `<span class="${stage === s ? 'on' : ''}">${stageLabel(s)}</span>`).join('')}
      </div>
      <div class="btn-row">
        <label class="field" style="flex:1;margin:0"><span>${tt('navCollab')}</span>
          <select id="collab-intent">
            ${state.intents.map((i) => `
              <option value="${escapeAttr(i.id)}" ${i.id === intent?.id ? 'selected' : ''}>
                ${escapeAttr(i.statement.slice(0, 40))} · ${stageLabel(i.collabStage || 'DRAFT')}
              </option>`).join('') || `<option value="">${tt('emptyIntents')}</option>`}
          </select>
        </label>
        <button type="button" class="btn btn-primary" id="collab-advance" ${intent && next ? '' : 'disabled'}>
          ${next ? `${tt('collabStageAdvance')} → ${stageLabel(next)}` : tt('collabStageDone')}
        </button>
      </div>
    </div>
    <div class="grid-2" style="margin-top:0.85rem">
      <div class="panel">
        <h3>${tt('roles')}</h3>
        ${['Cost', 'Experience', 'Sustainability', 'Compliance'].map((r) => `<div class="list-row"><span>${r}</span><span class="badge cyan">AI</span></div>`).join('')}
        <div class="btn-row" style="margin-top:0.75rem">
          <button type="button" class="btn btn-cyan" id="nego">${tt('negotiate')}</button>
          <button type="button" class="btn btn-ghost" id="embody">${tt('embody3d')}</button>
        </div>
        <h3 style="margin-top:1rem">${tt('roomNegotiate')} <span class="badge cyan">${tt('roomLive')}</span></h3>
        <div class="room-log" id="room-log-negotiate"></div>
        <div class="field"><textarea id="nego-text" placeholder="${tt('roomPlaceholder')}"></textarea></div>
        <button type="button" class="btn btn-primary" id="nego-send">${tt('sendRoom')}</button>
      </div>
      <div class="panel">
        <h3>${tt('embody3d')}</h3>
        <div class="scene-3d" id="collab-3d"></div>
      </div>
    </div>`;
  state.roomLogs.negotiate.forEach((m) => appendRoomLog('negotiate', m));
  connectSse('negotiate');
  void mountR3f('collab', 'collab-3d');
  el('collab-intent')?.addEventListener('change', (event) => {
    state.selectedIntentId = event.target.value || null;
    if (state.selectedIntentId) localStorage.setItem('forge.intent', state.selectedIntentId);
    renderCollab();
  });
  el('collab-advance')?.addEventListener('click', async () => {
    if (!intent || !next) return;
    try {
      await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intent.id)}`, {
        body: { collab_stage: next },
        idempotencyKey: `stage:${intent.id}:${next}`,
      });
      await refreshIntents();
      toast(`${stageLabel(stage)} → ${stageLabel(next)}`);
      renderCollab();
    } catch (error) { toast(error.message); }
  });
  el('nego')?.addEventListener('click', async () => {
    await api('POST', '/v1/forge/sse/negotiate/messages', {
      body: { text: state.locale === 'zh' ? '协商裁决：采纳 Cost 代理建议并写入责任链' : 'Negotiation: adopt Cost agent proposal onto custody chain' },
      idempotencyKey: `nego:${Date.now()}`,
    });
  });
  el('embody')?.addEventListener('click', () => toast(tt('embody3d')));
  el('nego-send')?.addEventListener('click', async () => {
    const text = el('nego-text').value.trim();
    if (!text) return;
    await api('POST', '/v1/forge/sse/negotiate/messages', {
      body: { text },
      idempotencyKey: `nego-msg:${Date.now()}`,
    });
    el('nego-text').value = '';
  });
}

async function refreshIntentTree(intentId) {
  if (!intentId) {
    state.intentTree = null;
    return;
  }
  try {
    const data = await api('GET', `/v1/forge/intents/${encodeURIComponent(intentId)}/tree`);
    state.intentTree = data.tree || null;
  } catch {
    state.intentTree = selectedIntent()?.intentTree || null;
  }
}

function renderTreeNodes(nodes) {
  const byParent = new Map();
  for (const node of nodes || []) {
    const key = node.parentId || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(node);
  }
  const walk = (parentId, depth) => {
    const kids = byParent.get(parentId || '') || [];
    return kids.map((node) => `
      <div class="tree-node" style="margin-left:${depth * 1.1}rem">
        <div class="list-row">
          <div>
            <div><span class="badge cyan">${treeKindLabel(node.kind)}</span> ${escapeAttr(node.title)}</div>
            <div class="stat-sub">${treeStatusLabel(node.status)} · <span class="mono">${escapeAttr(node.id.slice(0, 16))}</span></div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-ghost" data-tree-status="${escapeAttr(node.id)}" data-status="ALIGNED">${tt('treeAlign')}</button>
            <button type="button" class="btn btn-ghost" data-tree-status="${escapeAttr(node.id)}" data-status="CONFLICT">${tt('treeConflict')}</button>
            <button type="button" class="btn btn-cyan" data-tree-status="${escapeAttr(node.id)}" data-status="DONE">${tt('treeDone')}</button>
          </div>
        </div>
        ${walk(node.id, depth + 1)}
      </div>`).join('');
  };
  return walk(null, 0) || `<p class="empty">${tt('treeEmpty')}</p>`;
}

function renderTree() {
  setHeader(tt('navTree'), tt('treeTitle'), tt('treeSub'));
  const intent = selectedIntent();
  const tree = state.intentTree || intent?.intentTree;
  const roots = (tree?.nodes || []).filter((n) => !n.parentId);
  const rootId = roots[0]?.id || null;
  el('content').innerHTML = `
    <div class="panel" id="intent-tree-panel">
      <p class="empty">${tt('treeHint')}</p>
      <label class="field"><span>${tt('treeTitle')}</span>
        <select id="tree-intent">
          ${state.intents.map((i) => `
            <option value="${escapeAttr(i.id)}" ${i.id === intent?.id ? 'selected' : ''}>
              ${escapeAttr(i.statement.slice(0, 48))} · ${scenarioLabel(i.scenario || 'PRODUCT')}
            </option>`).join('') || `<option value="">${tt('treeEmpty')}</option>`}
        </select>
      </label>
      <div class="btn-row">
        <input id="tree-node-title" placeholder="${tt('treeNodePh')}" ${intent ? '' : 'disabled'}>
        <button type="button" class="btn btn-primary" id="tree-add-branch" ${intent && rootId ? '' : 'disabled'}>${tt('treeAddBranch')}</button>
        <button type="button" class="btn btn-ghost" id="tree-add-constraint" ${intent && rootId ? '' : 'disabled'}>${tt('treeAddConstraint')}</button>
        <button type="button" class="btn btn-ghost" id="tree-add-success" ${intent && rootId ? '' : 'disabled'}>${tt('treeAddSuccess')}</button>
      </div>
      <div id="tree-list" style="margin-top:0.85rem">
        ${intent ? renderTreeNodes(tree?.nodes || []) : `<p class="empty">${tt('treeEmpty')}</p>`}
      </div>
    </div>`;
  el('tree-intent')?.addEventListener('change', async (event) => {
    state.selectedIntentId = event.target.value || null;
    if (state.selectedIntentId) localStorage.setItem('forge.intent', state.selectedIntentId);
    await refreshIntentTree(state.selectedIntentId);
    renderTree();
  });
  const addNode = async (kind) => {
    if (!intent || !rootId) return;
    const title = el('tree-node-title')?.value?.trim();
    if (!title) return toast(tt('treeNodePh'));
    try {
      const data = await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/tree/nodes`, {
        body: { parent_id: rootId, kind, title },
        idempotencyKey: `tree-add:${intent.id}:${Date.now()}`,
      });
      state.intentTree = data.tree;
      el('tree-node-title').value = '';
      await refreshIntents();
      renderTree();
    } catch (error) { toast(error.message); }
  };
  el('tree-add-branch')?.addEventListener('click', () => addNode('BRANCH'));
  el('tree-add-constraint')?.addEventListener('click', () => addNode('CONSTRAINT'));
  el('tree-add-success')?.addEventListener('click', () => addNode('SUCCESS'));
  el('content').querySelectorAll('[data-tree-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!intent) return;
      try {
        const data = await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intent.id)}/tree/nodes/${encodeURIComponent(btn.dataset.treeStatus)}`, {
          body: { status: btn.dataset.status },
          idempotencyKey: `tree-st:${btn.dataset.treeStatus}:${btn.dataset.status}`,
        });
        state.intentTree = data.tree;
        await refreshIntents();
        renderTree();
      } catch (error) { toast(error.message); }
    });
  });
}

function lifeformStatusLabel(status) {
  if (status === 'FROZEN') return tt('lifeformFrozen');
  if (status === 'TERMINATED') return tt('lifeformTerminated');
  return tt('lifeformActive');
}

function proposalStatusLabel(status) {
  if (status === 'ACCEPTED') return tt('lifeformAccepted');
  if (status === 'REJECTED') return tt('lifeformRejected');
  return tt('lifeformPending');
}

async function refreshLifeforms() {
  try {
    const data = await api('GET', '/v1/forge/lifeforms');
    state.lifeforms = data.lifeforms || [];
    if (state.selectedLifeformId && !state.lifeforms.some((l) => l.id === state.selectedLifeformId)) {
      state.selectedLifeformId = state.lifeforms[0]?.id || null;
      if (state.selectedLifeformId) localStorage.setItem('forge.lifeform', state.selectedLifeformId);
      else localStorage.removeItem('forge.lifeform');
    }
  } catch {
    state.lifeforms = [];
  }
}

function renderDiscover() {
  setHeader(tt('navDiscover'), tt('discoverTitle'), tt('discoverSub'));
  const catalog = [
    { kind: 'project', titleZh: 'UrbanTwin 出行基础设施', titleEn: 'UrbanTwin mobility infrastructure', stake: 75 },
    { kind: 'project', titleZh: 'GridTwin 可再生调度', titleEn: 'GridTwin renewable dispatch', stake: 90 },
  ];
  const lifeforms = state.lifeforms || [];
  el('content').innerHTML = `
    <div class="panel">
      <h3>${tt('projects')}</h3>
      ${catalog.map((item, idx) => `
      <div class="list-row">
        <div>
          <div>${state.locale === 'zh' ? item.titleZh : item.titleEn}</div>
          <div class="stat-sub">${tt('project')}</div>
        </div>
        <div style="text-align:right">
          <div style="color:var(--cyan)">${item.stake} Credit</div>
          <button type="button" class="btn btn-cyan" data-stake="${idx}" style="margin-top:0.35rem">${tt('stakeJoin')}</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="panel" style="margin-top:0.85rem">
      <h3>${tt('lifeformCatalog')}</h3>
      ${lifeforms.length ? lifeforms.map((lf) => `
        <div class="list-row">
          <div>
            <div>${escapeAttr(lf.name)}</div>
            <div class="stat-sub">${tt('lifeform')} · ${lifeformStatusLabel(lf.status)} · <span class="mono">${escapeAttr(lf.intentId)}</span></div>
          </div>
          <div style="text-align:right">
            <button type="button" class="btn btn-ghost" data-open-life="${escapeAttr(lf.id)}">${tt('lifeformPanel')}</button>
          </div>
        </div>`).join('') : `<p class="empty">${tt('lifeformCatalogEmpty')}</p>`}
    </div>`;
  el('content').querySelectorAll('[data-stake]').forEach((btn) => btn.addEventListener('click', async () => {
    const item = catalog[Number(btn.dataset.stake)];
    try {
      const id = `forge:discover-${crypto.randomUUID()}`;
      await api('POST', '/v1/forge/intents', {
        body: {
          intent_id: id,
          statement: state.locale === 'zh' ? item.titleZh : item.titleEn,
          stake: item.stake,
          adapter_id: 'mfg-fab',
        },
        idempotencyKey: `discover:${id}`,
      });
      await refreshIntents();
      await refreshAccount();
      toast(tt('stakeJoin'));
      navigate('deploy');
    } catch (error) {
      toast(error.message);
    }
  }));
  el('content').querySelectorAll('[data-open-life]').forEach((btn) => btn.addEventListener('click', () => {
    state.selectedLifeformId = btn.dataset.openLife;
    localStorage.setItem('forge.lifeform', state.selectedLifeformId);
    navigate('deploy');
  }));
}

function renderCreate() {
  setHeader(tt('navCreate'), tt('createTitle'), tt('createSub'));
  const adapters = state.adapters.filter((a) => a.category === 'manufacturing');
  const defaults = [
    { key: 'mass', op: '<=', value: '180', unit: 'g' },
    { key: 'cost', op: '<=', value: '12', unit: 'USD' },
  ];
  el('content').innerHTML = `
    <div class="panel" style="max-width:42rem">
      <div class="field"><span>${tt('statement')}</span><textarea id="c-statement" placeholder="${tt('statementPh')}"></textarea></div>
      <div class="field"><span>${tt('constraints')}</span>
        <div class="stat-sub">${tt('constraintsPh')}</div>
        ${constraintsEditorHtml(defaults, { idPrefix: 'c', editable: true })}
      </div>
      <div class="field"><span>${tt('stakeAmount')}</span><input id="c-stake" type="number" min="1" value="50"></div>
      <div class="field"><span>${tt('createScenario')}</span>
        <select id="c-scenario">
          ${SCENARIOS.map((s) => `<option value="${s}" ${state.scenarioMode === s ? 'selected' : ''}>${scenarioLabel(s)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><span>${tt('adapter')}</span>
        <select id="c-adapter">${(adapters.length ? adapters : [{ adapterId: 'mfg-fab' }]).map((a) => `<option value="${a.adapterId}">${a.adapterId}</option>`).join('')}</select>
      </div>
      <button type="button" class="btn btn-primary" id="c-submit">${tt('submitCreate')}</button>
    </div>`;
  bindConstraintEditor('c');
  el('c-submit').addEventListener('click', async () => {
    const statement = el('c-statement').value.trim();
    if (!statement) return toast(tt('statement'));
    const constraints = readConstraintsFromEditor(document.getElementById('c-editor'));
    const id = `forge:${crypto.randomUUID()}`;
    const scenario = el('c-scenario').value || state.scenarioMode;
    try {
      await api('POST', '/v1/forge/intents', {
        body: {
          intent_id: id,
          statement,
          constraints,
          stake: Number(el('c-stake').value),
          adapter_id: el('c-adapter').value,
          scenario,
        },
        idempotencyKey: `create:${id}`,
      });
      state.selectedIntentId = id;
      state.scenarioMode = scenario;
      localStorage.setItem('forge.intent', id);
      localStorage.setItem('forge.scenario', scenario);
      await refreshIntents();
      await refreshAccount();
      toast(tt('submitCreate'));
      navigate('tree');
    } catch (error) {
      toast(error.message);
    }
  });
}

function pxnPathHtml(intent) {
  const path = intent?.pxnPath;
  if (!path) return `<p class="empty">${tt('emptyIntents')}</p>`;
  const rows = [
    [tt('pxnTask'), path.taskId || intent.pxnTaskId],
    [tt('pxnState'), path.taskState],
    [tt('pxnApproval'), path.approvalId],
    [tt('pxnPreflight'), path.preflightRunId],
    [tt('pxnQuote'), path.routeQuoteId],
    [tt('pxnDispatch'), path.dispatchId],
    [tt('pxnDispatchStatus'), path.dispatchStatus],
    [tt('pxnExecution'), path.executionId],
    [tt('pxnExecutor'), path.executorId],
    [tt('pxnVia'), path.via],
    [tt('pxnEvidence'), path.evidencePackageId],
    [tt('pxnAcceptance'), path.acceptanceId],
  ].filter(([, v]) => v);
  return rows.map(([k, v]) => `<div class="list-row"><span>${k}</span><span class="mono">${v}</span></div>`).join('');
}

function selectedLifeform() {
  return state.lifeforms.find((item) => item.id === state.selectedLifeformId) || state.lifeforms[0] || null;
}

function lifeformPanelHtml() {
  const settled = state.intents.filter((i) => i.status === 'SETTLED');
  const lifeform = selectedLifeform();
  const promotedIds = new Set(state.lifeforms.map((l) => l.intentId));
  const eligible = settled.filter((i) => !promotedIds.has(i.id));
  return `
    <div class="panel" style="margin-top:0.85rem" id="lifeform-panel">
      <h3>${tt('lifeformPanel')}</h3>
      <p class="empty">${tt('lifeformHint')}</p>
      <div class="field">
        <span>${tt('lifeformCreate')}</span>
        <select id="lifeform-intent">
          ${eligible.length
            ? eligible.map((i) => `<option value="${escapeAttr(i.id)}">${escapeAttr(i.statement.slice(0, 48))}</option>`).join('')
            : `<option value="">${tt('lifeformNoSettled')}</option>`}
        </select>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="lifeform-create" ${eligible.length ? '' : 'disabled'}>${tt('lifeformCreate')}</button>
        <button type="button" class="btn btn-ghost" id="lifeform-refresh">${tt('refresh')}</button>
      </div>
      ${state.lifeforms.length ? `
        <label class="field" style="margin-top:0.75rem"><span>${tt('lifeform')}</span>
          <select id="lifeform-pick">
            ${state.lifeforms.map((l) => `
              <option value="${escapeAttr(l.id)}" ${l.id === lifeform?.id ? 'selected' : ''}>
                ${escapeAttr(l.name)} · ${lifeformStatusLabel(l.status)}
              </option>`).join('')}
          </select>
        </label>` : `<p class="empty">${tt('lifeformEmpty')}</p>`}
      ${lifeform ? `
        <div class="list-row"><span>${tt('lifeformStatus')}</span><span>${lifeformStatusLabel(lifeform.status)}</span></div>
        <div class="list-row"><span>Intent</span><span class="mono">${escapeAttr(lifeform.intentId)}</span></div>
        <div class="btn-row">
          <button type="button" class="btn btn-warn" id="lifeform-freeze" ${lifeform.status !== 'ACTIVE' ? 'disabled' : ''}>${tt('lifeformFreeze')}</button>
          <button type="button" class="btn btn-cyan" id="lifeform-unfreeze" ${lifeform.status !== 'FROZEN' ? 'disabled' : ''}>${tt('lifeformUnfreeze')}</button>
          <button type="button" class="btn btn-ghost" id="lifeform-terminate" ${lifeform.status === 'TERMINATED' ? 'disabled' : ''}>${tt('lifeformTerminate')}</button>
        </div>
        <h3 style="margin-top:0.85rem">${tt('lifeformProposal')}</h3>
        <div class="field"><input id="lifeform-proposal-text" placeholder="${tt('lifeformProposalPh')}" ${lifeform.status !== 'ACTIVE' ? 'disabled' : ''}></div>
        <button type="button" class="btn btn-primary" id="lifeform-proposal-add" ${lifeform.status !== 'ACTIVE' ? 'disabled' : ''}>${tt('lifeformProposalAdd')}</button>
        <div id="lifeform-proposals" style="margin-top:0.65rem">
          ${lifeform.proposals?.length ? lifeform.proposals.map((p) => `
            <div class="list-row lifeform-proposal-row">
              <div>
                <div>${escapeAttr(p.summary)}</div>
                <div class="stat-sub">${proposalStatusLabel(p.status)} · <span class="mono">${escapeAttr(p.id.slice(0, 18))}</span></div>
              </div>
              ${p.status === 'PENDING' && lifeform.status === 'ACTIVE' ? `
                <div class="btn-row">
                  <button type="button" class="btn btn-cyan" data-accept="${escapeAttr(p.id)}">${tt('lifeformProposalAccept')}</button>
                  <button type="button" class="btn btn-warn" data-reject="${escapeAttr(p.id)}">${tt('lifeformProposalReject')}</button>
                </div>` : ''}
            </div>`).join('') : `<p class="empty">${tt('lifeformProposalEmpty')}</p>`}
        </div>` : ''}
    </div>`;
}

function bindLifeformPanel() {
  el('lifeform-refresh')?.addEventListener('click', async () => {
    await refreshLifeforms();
    renderDeploy();
  });
  el('lifeform-pick')?.addEventListener('change', (event) => {
    state.selectedLifeformId = event.target.value || null;
    if (state.selectedLifeformId) localStorage.setItem('forge.lifeform', state.selectedLifeformId);
    renderDeploy();
  });
  el('lifeform-create')?.addEventListener('click', async () => {
    const intentId = el('lifeform-intent')?.value;
    if (!intentId) return;
    try {
      const created = await api('POST', '/v1/forge/lifeforms', {
        body: { intent_id: intentId },
        idempotencyKey: `lifeform:${intentId}`,
      });
      state.selectedLifeformId = created.id;
      localStorage.setItem('forge.lifeform', created.id);
      await refreshLifeforms();
      toast(tt('lifeformCreated'));
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('lifeform-freeze')?.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    if (!lifeform) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/status`, {
        body: { status: 'FROZEN' },
        idempotencyKey: `life-freeze:${lifeform.id}:${Date.now()}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('lifeform-unfreeze')?.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    if (!lifeform) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/status`, {
        body: { status: 'ACTIVE' },
        idempotencyKey: `life-unfreeze:${lifeform.id}:${Date.now()}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('lifeform-terminate')?.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    if (!lifeform) return;
    if (!window.confirm(tt('lifeformTerminateConfirm'))) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/status`, {
        body: { status: 'TERMINATED' },
        idempotencyKey: `life-term:${lifeform.id}:${Date.now()}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('lifeform-proposal-add')?.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    const summary = el('lifeform-proposal-text')?.value?.trim();
    if (!lifeform || !summary) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/proposals`, {
        body: { summary },
        idempotencyKey: `life-prop:${lifeform.id}:${Date.now()}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('content').querySelectorAll('[data-accept]').forEach((btn) => btn.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    if (!lifeform) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/proposals/${encodeURIComponent(btn.dataset.accept)}/decide`, {
        body: { decision: 'ACCEPTED' },
        idempotencyKey: `life-acc:${btn.dataset.accept}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  }));
  el('content').querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const lifeform = selectedLifeform();
    if (!lifeform) return;
    try {
      await api('POST', `/v1/forge/lifeforms/${encodeURIComponent(lifeform.id)}/proposals/${encodeURIComponent(btn.dataset.reject)}/decide`, {
        body: { decision: 'REJECTED' },
        idempotencyKey: `life-rej:${btn.dataset.reject}`,
      });
      await refreshLifeforms();
      renderDeploy();
    } catch (error) { toast(error.message); }
  }));
}

function renderDeploy() {
  setHeader(tt('navDeploy'), tt('deployTitle'), tt('deploySub'));
  const intent = selectedIntent();
  el('content').innerHTML = `
    <div class="stage-rail">
      ${['STAKED', 'CONFIRMED', 'DEPLOYING', 'FEEDBACK', 'SETTLED'].map((s) => `<span class="${intent?.status === s ? 'on' : ''}">${s}</span>`).join('')}
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>${tt('mfgParams')}</h3>
        <div class="list-row"><span>Material</span><span>PETG / Al 6061</span></div>
        <div class="list-row"><span>Process</span><span>FDM · CNC</span></div>
        <div class="list-row"><span>Adapter</span><span class="mono">${intent?.adapterId || 'mfg-fab'}</span></div>
        <div class="list-row"><span>${tt('status')}</span><span>${intent?.status || '—'}</span></div>
        <p class="empty">${intent?.status === 'SETTLED' ? tt('loopDone') : tt('needConfirm')}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-cyan" id="d-confirm" ${!intent || intent.status !== 'STAKED' ? 'disabled' : ''}>${tt('confirmHuman')}</button>
          <button type="button" class="btn btn-warn" id="d-deploy" ${!intent || intent.status !== 'CONFIRMED' ? 'disabled' : ''}>${tt('deployGateway')}</button>
          <button type="button" class="btn btn-primary" id="d-feedback" ${!intent || (intent.status !== 'DEPLOYING' && intent.status !== 'FEEDBACK') ? 'disabled' : ''}>${tt('advanceFeedback')}</button>
          <button type="button" class="btn btn-ghost" id="d-partner">${tt('partnerDrill')}</button>
        </div>
        <label class="field" style="margin-top:0.75rem"><span>${tt('navDeploy')}</span>
          <select id="intent-pick">${state.intents.map((i) => `<option value="${i.id}" ${i.id === intent?.id ? 'selected' : ''}>${i.status} · ${i.statement.slice(0, 40)}</option>`).join('')}</select>
        </label>
        <div class="pxn-path">
          <h3>${tt('pxnPath')}</h3>
          ${pxnPathHtml(intent)}
        </div>
        <h3>${tt('partnerEvents')}</h3>
        <div id="partner-feed">${partnerEventsHtml()}</div>
      </div>
      <div class="panel">
        <h3>${tt('lifeform3d')}</h3>
        <div class="scene-3d" id="lifeform-3d"></div>
        <h3 style="margin-top:0.85rem">${tt('gatewayJobs')}</h3>
        ${intent?.deployJob ? `<pre class="mono" style="white-space:pre-wrap;margin:0;color:#c9d4e8">${JSON.stringify(intent.deployJob, null, 2)}</pre>` : `<p class="empty">${tt('emptyIntents')}</p>`}
      </div>
    </div>
    ${lifeformPanelHtml()}`;
  void mountR3f('lifeform', 'lifeform-3d');
  void refreshPartner().then(() => {
    const feed = document.getElementById('partner-feed');
    if (feed) feed.innerHTML = partnerEventsHtml();
  });
  bindLifeformPanel();
  el('intent-pick')?.addEventListener('change', (e) => {
    state.selectedIntentId = e.target.value;
    localStorage.setItem('forge.intent', state.selectedIntentId);
    renderDeploy();
  });
  el('d-confirm')?.addEventListener('click', async () => {
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/confirm`, { idempotencyKey: `confirm:${intent.id}` });
      await refreshIntents();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('d-deploy')?.addEventListener('click', async () => {
    if (!state.marketOwned) {
      toast(state.locale === 'zh' ? '请先在市场解锁部署资格' : 'Unlock deploy eligibility in Marketplace first');
      return navigate('market');
    }
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/deploy`, { idempotencyKey: `deploy:${intent.id}` });
      if (intent) {
        await api('POST', '/v1/forge/partner/outbound', {
          body: { kind: 'fab.job.create', intent_id: intent.id, payload: { statement: intent.statement } },
          idempotencyKey: `partner-deploy:${intent.id}`,
        });
      }
      await refreshIntents();
      await refreshPartner();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('d-feedback')?.addEventListener('click', async () => {
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(intent.id)}/feedback`, { idempotencyKey: `fb:${intent.id}:${Date.now()}` });
      await refreshIntents();
      await refreshAccount();
      await refreshPartner();
      renderDeploy();
    } catch (error) { toast(error.message); }
  });
  el('d-partner')?.addEventListener('click', async () => {
    try {
      await api('POST', '/v1/forge/partner/outbound', {
        body: {
          kind: 'fab.job.drill',
          intent_id: intent?.id,
          payload: { note: 'manual drill from deploy' },
        },
        idempotencyKey: `partner-drill:${Date.now()}`,
      });
      await refreshPartner();
      toast(tt('partnerDrill'));
      const feed = document.getElementById('partner-feed');
      if (feed) feed.innerHTML = partnerEventsHtml();
    } catch (error) { toast(error.message); }
  });
}

function renderMarket() {
  setHeader(tt('navMarket'), tt('marketTitle'), tt('marketSub'));
  el('content').innerHTML = `
    <div class="grid-3">
      <div class="panel"><div class="stat-label">${tt('plan')}</div><div class="stat-value" style="font-size:1.2rem">Studio</div><div class="stat-sub">200 Credit / cycle</div><button class="btn btn-primary" id="buy-plan" style="margin-top:0.75rem">${tt('checkout')}</button></div>
      <div class="panel"><div class="stat-label">${tt('component')}</div><div class="stat-value" style="font-size:1.2rem">Bracket Kit</div><div class="stat-sub">80 Credit</div><button class="btn btn-cyan" id="buy-kit" style="margin-top:0.75rem">${tt('checkout')}</button></div>
      <div class="panel"><div class="stat-label">${tt('lifeform')}</div><div class="stat-value" style="font-size:1.2rem">Struct-01</div><div class="stat-sub">150 Credit</div><button class="btn btn-ghost" id="buy-life" style="margin-top:0.75rem">${tt('checkout')}</button></div>
    </div>
    <p class="empty" style="margin-top:0.85rem">${state.marketOwned ? tt('owned') : ''}</p>`;
  const buy = async () => {
    state.marketOwned = true;
    localStorage.setItem('forge.market', 'true');
    toast(tt('owned'));
    renderMarket();
  };
  el('buy-plan')?.addEventListener('click', () => buy());
  el('buy-kit')?.addEventListener('click', () => buy());
  el('buy-life')?.addEventListener('click', () => buy());
}

function renderAccount() {
  setHeader(tt('navAccount'), tt('accountTitle'), tt('accountSub'));
  el('content').innerHTML = `
    <div class="panel" style="max-width:36rem">
      <div class="list-row"><span>${tt('tenant')}</span><span class="mono">${state.tenantId}</span></div>
      <div class="list-row"><span>${tt('principal')}</span><span class="mono">${state.actorId}</span></div>
      <div class="list-row"><span>${tt('provider')}</span><span>sandbox / stripe-test</span></div>
      <div class="list-row"><span>${tt('credit')}</span><span class="cyan" style="color:var(--cyan)">${state.account?.balance ?? '—'}</span></div>
      <div class="list-row"><span>${tt('staked')}</span><span>${state.account?.staked ?? 0}</span></div>
      <div class="btn-row" style="margin-top:0.85rem">
        <button type="button" class="btn btn-primary" id="topup">${tt('topUpBtn')}</button>
      </div>
    </div>`;
  el('topup').addEventListener('click', async () => {
    try {
      state.account = await api('POST', '/v1/forge/accounts/topup', {
        body: { amount: 500 },
        idempotencyKey: `topup:${Date.now()}`,
      });
      el('credit-bal').textContent = String(state.account.balance);
      toast(tt('topUp'));
      renderAccount();
    } catch (error) { toast(error.message); }
  });
}

function renderConnections() {
  setHeader(tt('navConnections'), tt('connectionsTitle'), tt('connectionsSub'));
  const cats = [
    ['all', 'all'],
    ['manufacturing', 'catMfg'],
    ['supply_chain', 'catSc'],
    ['intelligence', 'catIntel'],
    ['identity', 'catId'],
    ['commerce', 'catCom'],
    ['observability', 'catOps'],
  ];
  const filtered = state.connFilter === 'all'
    ? state.adapters
    : state.adapters.filter((a) => a.category === state.connFilter);
  const cfg = state.partnerConfig;
  el('content').innerHTML = `
    <div class="panel" style="margin-bottom:0.85rem">
      <h3>${tt('partnerTitle')}</h3>
      <p class="empty">${tt('partnerHint')}</p>
      <div class="field"><span>${tt('partnerOutbound')}</span><input id="partner-url" value="${cfg?.outboundUrl ?? 'http://127.0.0.1:3000/v1/forge/partner/webhook-receiver'}"></div>
      <label class="field" style="display:flex;align-items:center;gap:0.5rem">
        <input id="partner-enabled" type="checkbox" ${cfg?.enabled !== false ? 'checked' : ''}>
        <span>${tt('partnerEnabled')}</span>
      </label>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="partner-save">${tt('partnerSave')}</button>
        <button type="button" class="btn btn-cyan" id="partner-drill">${tt('partnerDrill')}</button>
        <button type="button" class="btn btn-ghost" id="partner-callback">${tt('partnerCallback')}</button>
      </div>
      <div class="stat-sub" style="margin-top:0.55rem">${tt('partnerReceiver')}: <span class="mono">/v1/forge/partner/webhook-receiver</span></div>
      <h3 style="margin-top:0.85rem">${tt('partnerEvents')}</h3>
      <div id="partner-feed">${partnerEventsHtml()}</div>
    </div>
    <div class="tabs">${cats.map(([id, key]) => `<button type="button" class="tab${state.connFilter === id ? ' active' : ''}" data-cat="${id}">${tt(key)}</button>`).join('')}</div>
    <div class="grid-2">
      ${filtered.map((a) => `
        <div class="panel adapter-card">
          <header><strong>${a.adapterId}</strong><span class="badge">${tt('sim')}</span></header>
          <div class="mono">${a.category} · ${a.mode} · ${a.healthy ? 'ok' : 'down'}</div>
          <button type="button" class="btn btn-cyan" data-drill="${a.adapterId}">${tt('drill')}</button>
        </div>`).join('') || `<p class="empty">${tt('emptyIntents')}</p>`}
    </div>`;
  void refreshPartner().then(() => {
    const feed = document.getElementById('partner-feed');
    if (feed) feed.innerHTML = partnerEventsHtml();
    if (state.partnerConfig && el('partner-url')) {
      el('partner-url').value = state.partnerConfig.outboundUrl;
      el('partner-enabled').checked = state.partnerConfig.enabled;
    }
  });
  el('content').querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => {
    state.connFilter = btn.dataset.cat;
    renderConnections();
  }));
  el('content').querySelectorAll('[data-drill]').forEach((btn) => btn.addEventListener('click', async () => {
    await api('POST', '/v1/forge/partner/outbound', {
      body: { kind: `adapter.drill.${btn.dataset.drill}`, payload: { adapterId: btn.dataset.drill } },
      idempotencyKey: `drill:${btn.dataset.drill}:${Date.now()}`,
    });
    await refreshPartner();
    toast(`${tt('drill')}: ${btn.dataset.drill}`);
    renderConnections();
  }));
  el('partner-save')?.addEventListener('click', async () => {
    state.partnerConfig = await api('PUT', '/v1/forge/partner/config', {
      body: {
        outbound_url: el('partner-url').value.trim(),
        enabled: el('partner-enabled').checked,
      },
      idempotencyKey: `partner-cfg:${Date.now()}`,
    });
    toast(tt('partnerSave'));
  });
  el('partner-drill')?.addEventListener('click', async () => {
    await api('POST', '/v1/forge/partner/outbound', {
      body: { kind: 'fab.job.drill', payload: { source: 'connections' } },
      idempotencyKey: `partner-out:${Date.now()}`,
    });
    await refreshPartner();
    toast(tt('partnerDrill'));
    renderConnections();
  });
  el('partner-callback')?.addEventListener('click', async () => {
    await api('POST', '/v1/forge/partner/callbacks', {
      body: { kind: 'fab.progress', payload: { progressPct: 64, qc: 'IN_PROGRESS' } },
    });
    await refreshPartner();
    toast(tt('partnerCallback'));
    renderConnections();
  });
}

async function refreshSnapshots() {
  const eligible = state.intents.filter((i) => i.status === 'STAKED' || i.status === 'CONFIRMED');
  if (!state.snapshotIntentId || !eligible.some((i) => i.id === state.snapshotIntentId)) {
    state.snapshotIntentId = eligible[0]?.id || null;
    if (state.snapshotIntentId) localStorage.setItem('forge.snapshotIntent', state.snapshotIntentId);
  }
  if (!state.snapshotIntentId) {
    state.snapshots = [];
    return;
  }
  try {
    const data = await api('GET', `/v1/forge/intents/${encodeURIComponent(state.snapshotIntentId)}/snapshots`);
    state.snapshots = data.snapshots || [];
  } catch {
    state.snapshots = [];
  }
}

function renderGovernance() {
  setHeader(tt('navGovernance'), tt('govTitle'), tt('govSub'));
  const pending = state.intents.filter((i) => i.status === 'STAKED');
  const snapshotEligible = state.intents.filter((i) => i.status === 'STAKED' || i.status === 'CONFIRMED');
  const snapIntent = snapshotEligible.find((i) => i.id === state.snapshotIntentId) || null;
  const audit = state.intents.flatMap((i) => (i.events || []).map((e) => ({ ...e, intentId: i.id })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  el('content').innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <h3>${tt('pending')}</h3>
        ${pending.length ? pending.map((p) => `
          <div class="list-row">
            <span>${p.statement.slice(0, 40)}</span>
            <button type="button" class="btn btn-cyan" data-approve="${p.id}">${tt('approve')}</button>
          </div>`).join('') : `<p class="empty">${tt('emptyIntents')}</p>`}
        <h3 style="margin-top:1rem">${tt('roomGovernance')} <span class="badge cyan">${tt('roomLive')}</span></h3>
        <div class="room-log" id="room-log-governance"></div>
        <div class="field"><textarea id="gov-text" placeholder="${tt('roomPlaceholder')}"></textarea></div>
        <button type="button" class="btn btn-primary" id="gov-send">${tt('sendRoom')}</button>
      </div>
      <div class="panel">
        <h3>${tt('audit')}</h3>
        ${audit.length ? audit.map((e) => `<div class="list-row"><span class="mono">${e.type}</span><span>${e.at.slice(11, 19)}</span></div>`).join('') : `<p class="empty">—</p>`}
      </div>
    </div>
    <div class="panel" style="margin-top:0.85rem" id="snapshot-panel">
      <h3>${tt('snapshotTitle')}</h3>
      <p class="empty">${tt('snapshotHint')}</p>
      <label class="field">
        <span>${tt('snapshotIntent')}</span>
        <select id="snapshot-intent">
          ${snapshotEligible.length
            ? snapshotEligible.map((i) => `
              <option value="${escapeAttr(i.id)}" ${i.id === state.snapshotIntentId ? 'selected' : ''}>
                ${escapeAttr(i.statement.slice(0, 40))} · ${i.status}
              </option>`).join('')
            : `<option value="">${tt('snapshotNoEligible')}</option>`}
        </select>
      </label>
      ${snapIntent?.pxnTaskId ? `<div class="stat-sub mono">${tt('snapshotPxnHint')}: ${escapeAttr(snapIntent.pxnTaskId)}</div>` : ''}
      <div class="btn-row" style="margin:0.65rem 0">
        <button type="button" class="btn btn-primary" id="snapshot-create" ${snapIntent ? '' : 'disabled'}>${tt('snapshotCreate')}</button>
        <button type="button" class="btn btn-ghost" id="snapshot-refresh" ${snapIntent ? '' : 'disabled'}>${tt('refresh')}</button>
      </div>
      <div id="snapshot-list">
        ${state.snapshots.length ? state.snapshots.map((s) => `
          <div class="list-row snapshot-row">
            <span>
              <span class="mono">${escapeAttr(s.contentHash.slice(0, 10))}…</span>
              · ${(s.createdAt || '').slice(0, 19).replace('T', ' ')}
              · ${escapeAttr(s.createdBy)}
              ${s.pxnTaskId ? `<div class="stat-sub mono">${tt('snapshotPxnHint')}: ${escapeAttr(s.pxnTaskId)}</div>` : ''}
            </span>
            <button type="button" class="btn btn-warn" data-restore="${escapeAttr(s.id)}">${tt('snapshotRestore')}</button>
          </div>`).join('') : `<p class="empty">${tt('snapshotEmpty')}</p>`}
      </div>
    </div>`;
  state.roomLogs.governance.forEach((m) => appendRoomLog('governance', m));
  connectSse('governance');
  el('content').querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(btn.dataset.approve)}/confirm`, {
        idempotencyKey: `gov:${btn.dataset.approve}`,
      });
      await api('POST', '/v1/forge/sse/governance/messages', {
        body: { text: state.locale === 'zh' ? `已批准部署 ${btn.dataset.approve}` : `Approved deploy ${btn.dataset.approve}` },
        idempotencyKey: `gov-msg:${btn.dataset.approve}`,
      });
      await refreshIntents();
      toast(tt('approve'));
      void refreshSnapshots().then(() => renderGovernance());
    } catch (error) { toast(error.message); }
  }));
  el('gov-send')?.addEventListener('click', async () => {
    const text = el('gov-text').value.trim();
    if (!text) return;
    await api('POST', '/v1/forge/sse/governance/messages', {
      body: { text },
      idempotencyKey: `gov-chat:${Date.now()}`,
    });
    el('gov-text').value = '';
  });
  el('snapshot-intent')?.addEventListener('change', (event) => {
    state.snapshotIntentId = event.target.value || null;
    if (state.snapshotIntentId) localStorage.setItem('forge.snapshotIntent', state.snapshotIntentId);
    void refreshSnapshots().then(() => renderGovernance());
  });
  el('snapshot-create')?.addEventListener('click', async () => {
    if (!state.snapshotIntentId) return;
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(state.snapshotIntentId)}/snapshots`, {
        idempotencyKey: `snap:${state.snapshotIntentId}:${Date.now()}`,
      });
      await refreshIntents();
      await refreshSnapshots();
      toast(tt('snapshotCreated'));
      renderGovernance();
    } catch (error) { toast(error.message); }
  });
  el('snapshot-refresh')?.addEventListener('click', () => {
    void refreshSnapshots().then(() => renderGovernance());
  });
  el('content').querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!state.snapshotIntentId) return;
    if (!window.confirm(tt('snapshotConfirm'))) return;
    try {
      await api('POST', `/v1/forge/intents/${encodeURIComponent(state.snapshotIntentId)}/snapshots/${encodeURIComponent(btn.dataset.restore)}/restore`, {
        idempotencyKey: `restore:${btn.dataset.restore}:${Date.now()}`,
      });
      await refreshIntents();
      await refreshSnapshots();
      toast(tt('snapshotRestored'));
      renderGovernance();
    } catch (error) { toast(error.message); }
  }));
}

async function refreshAllocations() {
  try {
    const data = await api('GET', '/v1/forge/allocation-weights');
    if (data.weights) state.allocationWeights = data.weights;
  } catch {
    /* keep defaults */
  }
  const settled = state.intents.filter((i) => i.status === 'SETTLED');
  const next = {};
  await Promise.all(settled.map(async (intent) => {
    try {
      const data = await api('GET', `/v1/forge/intents/${encodeURIComponent(intent.id)}/allocations`);
      next[intent.id] = data.allocations || [];
      if (data.weights) state.allocationWeights = data.weights;
    } catch {
      next[intent.id] = [];
    }
  }));
  state.allocationsByIntent = next;
}

function roleLabel(role) {
  if (role === 'proposer') return tt('proposer');
  if (role === 'suggester') return tt('suggester');
  if (role === 'confirmer') return tt('confirmer');
  return role;
}

function renderEquity() {
  setHeader(tt('navEquity'), tt('equityTitle'), tt('equitySub'));
  const settled = state.intents.filter((i) => i.status === 'SETTLED');
  const minted = settled.reduce((sum, i) => sum + (i.creditMinted || 0), 0);
  const w = state.allocationWeights || {};
  const fmtPct = (n) => `${Number(n ?? 0).toFixed(1)}%`;
  el('content').innerHTML = `
    <div class="grid-3">
      <div class="panel"><div class="stat-label">${tt('proposer')}</div><div class="stat-value">${fmtPct(w.proposer)}</div><div class="stat-sub">${tt('weightFromConfig')}</div></div>
      <div class="panel"><div class="stat-label">${tt('suggester')}</div><div class="stat-value">${fmtPct(w.suggester)}</div><div class="stat-sub">${tt('weightFromConfig')}</div></div>
      <div class="panel"><div class="stat-label">${tt('confirmer')}</div><div class="stat-value">${fmtPct(w.confirmer)}</div><div class="stat-sub">${tt('weightFromConfig')}</div></div>
    </div>
    <div class="panel" style="margin-top:0.85rem" id="realized-panel">
      <h3>${tt('realizedTitle')}</h3>
      <div class="stat-label">${tt('minted')}</div>
      <div class="stat-value cyan">${minted}</div>
      <div class="stat-sub">${tt('settlePreview')} · ${settled.length} settled</div>
      ${settled.length ? settled.map((intent) => {
        const rows = state.allocationsByIntent[intent.id] || [];
        return `
          <div class="realized-block">
            <div class="list-row"><span>${escapeAttr(intent.statement.slice(0, 48))}</span><span class="cyan">+${intent.creditMinted ?? 0}</span></div>
            ${rows.length ? rows.map((row) => `
              <div class="list-row realized-row">
                <span>${roleLabel(row.role)} · <span class="mono">${escapeAttr(row.principalId)}</span></span>
                <span>${Number(row.weightPercent).toFixed(1)}% · <strong>+${row.amount}</strong></span>
              </div>`).join('') : `<p class="empty">${tt('realizedNoSplit')}</p>`}
          </div>`;
      }).join('') : `<p class="empty">${tt('realizedEmpty')}</p>`}
    </div>`;
}

function renderHistory() {
  setHeader(tt('navHistory'), tt('historyTitle'), tt('historySub'));
  const filter = state.historyFilter;
  const options = [
    ['all', tt('historyAll')],
    ['selected', tt('historyCurrent')],
    ...state.intents.map((intent) => [intent.id, intent.statement.slice(0, 36) || intent.id]),
  ];
  const items = state.timeline;
  el('content').innerHTML = `
    <div class="history-toolbar">
      <label class="field history-filter">
        <span>${tt('historyFilter')}</span>
        <select id="history-filter">
          ${options.map(([value, label]) => `
            <option value="${escapeAttr(value)}" ${filter === value ? 'selected' : ''}>${escapeAttr(label)}</option>
          `).join('')}
        </select>
      </label>
      <button type="button" class="btn btn-ghost" id="history-refresh">${tt('refresh')}</button>
    </div>
    <div class="timeline" id="history-timeline">
      ${items.length ? items.map((item, index) => `
        <article class="timeline-card panel ${timelineKindClass(item.kind)}" style="animation-delay:${Math.min(index, 12) * 40}ms">
          <div class="timeline-kind">${timelineKindLabel(item.kind)}</div>
          <div class="timeline-body">${escapeAttr(timelineSummary(item))}</div>
          <div class="timeline-meta">
            <span class="mono">${escapeAttr(item.intentId)}</span>
            <span>${(item.at || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z')}</span>
          </div>
        </article>`).join('') : `<p class="empty">${tt('historyEmpty')}</p>`}
    </div>`;
  el('history-filter')?.addEventListener('change', (event) => {
    state.historyFilter = event.target.value;
    localStorage.setItem('forge.historyFilter', state.historyFilter);
    void refreshTimeline().then(() => renderHistory());
  });
  el('history-refresh')?.addEventListener('click', () => {
    void refreshTimeline().then(() => {
      toast(tt('historyRefreshed'));
      renderHistory();
    });
  });
}

function renderPage() {
  const map = {
    overview: renderOverview,
    tree: renderTree,
    workbench: renderWorkbench,
    collab: renderCollab,
    discover: renderDiscover,
    create: renderCreate,
    deploy: renderDeploy,
    market: renderMarket,
    account: renderAccount,
    connections: renderConnections,
    governance: renderGovernance,
    equity: renderEquity,
    history: renderHistory,
  };
  if (state.page === 'workbench') {
    void (async () => {
      await refreshVariantsAndJudgments();
      const intent = selectedIntent();
      if (intent) await refreshMemories(intent.id);
      renderWorkbench();
    })();
    return;
  }
  if (state.page === 'tree') {
    void (async () => {
      const intent = selectedIntent();
      if (intent) await refreshIntentTree(intent.id);
      renderTree();
    })();
    return;
  }
  if (state.page === 'history') {
    void refreshTimeline().then(() => renderHistory());
    return;
  }
  if (state.page === 'equity') {
    void refreshAllocations().then(() => renderEquity());
    return;
  }
  if (state.page === 'governance') {
    void refreshSnapshots().then(() => renderGovernance());
    return;
  }
  if (state.page === 'discover') {
    void refreshLifeforms().then(() => renderDiscover());
    return;
  }
  if (state.page === 'deploy') {
    void refreshLifeforms().then(() => renderDeploy());
    return;
  }
  (map[state.page] || renderOverview)();
}

el('lang-zh').addEventListener('click', () => {
  state.locale = 'zh';
  localStorage.setItem('forge.locale', 'zh');
  applyChromeI18n();
  renderPage();
});
el('lang-en').addEventListener('click', () => {
  state.locale = 'en';
  localStorage.setItem('forge.locale', 'en');
  applyChromeI18n();
  renderPage();
});
el('menu-btn').addEventListener('click', () => {
  el('sidebar').classList.toggle('open');
  el('overlay').classList.toggle('open');
});
el('overlay').addEventListener('click', () => {
  el('sidebar').classList.remove('open');
  el('overlay').classList.remove('open');
});

// Default market eligibility for demo loop convenience after first visit remains gated;
// first-time users unlock via marketplace checkout.
if (localStorage.getItem('forge.market') === null) {
  state.marketOwned = true;
  localStorage.setItem('forge.market', 'true');
}

applyChromeI18n();
await refreshAccount();
await refreshAdapters();
await refreshIntents();
await refreshVariantsAndJudgments();
renderPage();
