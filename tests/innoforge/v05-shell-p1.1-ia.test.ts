import assert from 'node:assert/strict';
import test from 'node:test';

import { buildForgeApp } from '../../apps/forge-server/src/app.js';
import { InMemoryForgeLoopService } from '../../apps/forge-server/src/modules/innoforge/forge-loop.js';

test('P1.1 shell IA: land validate, no scenario primary, loop collapsed, assets nav', async () => {
  const service = new InMemoryForgeLoopService();
  const app = await buildForgeApp({
    healthProbe: { check: async () => Object.freeze({ status: 'ok', database: 'up' }) },
    forgeLoopService: service,
  });
  try {
    const js = await app.inject({ method: 'GET', url: '/forge/app.js' });
    assert.equal(js.statusCode, 200);
    assert.match(js.body, /migrateShellPage/);
    assert.match(js.body, /forge\.iaP11/);
    assert.match(js.body, /projectTab.*validate|migrateProjectTab/);
    assert.match(js.body, /navAssets/);
    assert.match(js.body, /nav-loop/);
    assert.match(js.body, /project-name-btn|projectSwitcher/);
    assert.match(js.body, /renderAssetsLibrary/);
    assert.match(js.body, /overview-glance|overviewDecision/);
    // Scenario pills must not be rendered in primary nav
    assert.doesNotMatch(js.body, /id="scenario-switch"/);
    assert.doesNotMatch(js.body, /scenario-workspace-chip/);
    assert.match(js.body, /account-scenario/);

    const css = await app.inject({ method: 'GET', url: '/forge/styles.css' });
    assert.match(css.body, /scenario-switch\s*\{\s*display:\s*none/);
    assert.match(css.body, /status-chip\s*\{\s*display:\s*none/);

    const html = await app.inject({ method: 'GET', url: '/forge' });
    assert.doesNotMatch(html.body, /status-chip/);
    assert.doesNotMatch(html.body, /baseHint|sessionDemo/);

    const i18n = await app.inject({ method: 'GET', url: '/forge/i18n.js' });
    assert.match(i18n.body, /navAssets: '资产'/);
    assert.match(i18n.body, /projectSwitcher/);
    assert.match(i18n.body, /assetsSegmentPersonal/);
    assert.doesNotMatch(i18n.body, /场景工作区 ·/);
  } finally {
    await app.close();
  }
});
