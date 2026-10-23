import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';

test('plain labels: shell tabs everyday words; no academic nav strings', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.equal(i18n.statusCode, 200);
    assert.match(i18n.body, /projectTabValidate: '做事'/);
    assert.match(i18n.body, /projectTabValidate: 'Work'/);
    assert.match(i18n.body, /projectTabIntent: '目标'/);
    assert.match(i18n.body, /projectTabIntent: 'Goals'/);
    assert.match(i18n.body, /projectTabEvidence: '结果'/);
    assert.match(i18n.body, /projectTabEvidence: 'Results'/);
    assert.match(i18n.body, /projectTabAssets: '文件'/);
    assert.match(i18n.body, /projectTabAssets: 'Files'/);
    assert.match(i18n.body, /tagline: ''/);
    assert.doesNotMatch(i18n.body, /创造流程操作系统/);
    assert.doesNotMatch(i18n.body, /要证明什么/);
    assert.doesNotMatch(i18n.body, /文件与分成/);
    assert.doesNotMatch(i18n.body, /Files & share/);
    assert.match(i18n.body, /navMyTasks: '我的事'/);
    assert.match(i18n.body, /navMyTasks: 'My work'/);
    assert.match(i18n.body, /navAssets: '文件'/);
    assert.match(i18n.body, /navGroupLoop: '更多'/);
    assert.match(i18n.body, /navGroupLoop: 'More'/);
    assert.doesNotMatch(i18n.body, /意图与假设/);
    assert.doesNotMatch(i18n.body, /证据与决策/);
    assert.doesNotMatch(i18n.body, /验证与任务/);
    assert.doesNotMatch(i18n.body, /Intent & hypotheses/);
    assert.doesNotMatch(i18n.body, /Evidence & decisions/);
    assert.doesNotMatch(i18n.body, /Validate & tasks/);
    assert.doesNotMatch(i18n.body, /Loop · Intent OS/);

    // Studio CTAs still carry money / next action (value without manuals)
    const wb = await app.inject({ method: 'GET', url: '/forge/workbench.js' });
    assert.match(wb.body, /接下制作|Accept job/);
    assert.match(wb.body, /¥600|600/);
  } finally {
    await app.close();
  }
});
