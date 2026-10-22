# 设计稿 vs PXN 实现：差异与实现计划

**版本**：v1.0 · 2026-10-18  
**main 对照**：`luoyanjiang/PXN` @ `91bdbf4` · `/forge`  
**本轮范围**：并排差异 + 分项技术设计草稿 + 分期 backlog。**不写功能代码、不开实现 PR、不合并。**

---

## 0. 强制工作方式（用户偏好）

相对设计稿的每一项缺口：

1. **先写技术设计**（问题、PXN 模块、API/数据、UX、验收、风险）→ 本文件 §4 或 `docs/tech/` 子文档  
2. **状态变为「设计完成 / 待开发」后，再等人确认**  
3. **确认前禁止编码**该缺口  
4. 编码后：本地 CI（`innoforge:test` / typecheck / lint）→ 按需合入；不等待 GitHub Actions  

状态枚举：`设计中` · `设计完成` · `待开发` · `开发中` · `已合入` · `外部阻塞`

---

## 1. 对照源

| 源 | 角色 |
|----|------|
| [intent-os-full.html](./intent-os-full.html) | Intent OS 首版交互（8 屏：总览/孪生/权益/历史/发现/创建/调度/兑现） |
| [innoforge-product-design.md](./innoforge-product-design.md) | 现行整合 IA（11 屏 + 闭环） |
| [Intent-OS-产品方案.md](./Intent-OS-产品方案.md) | 意图/孪生/Credit/确认/兑现权威原则 |
| [InnoForge-产品设计文档-更新版.md](./InnoForge-产品设计文档-更新版.md) | 协商、具身、Lumen、生命体、治理 |
| [innoforge-external-systems.md](./innoforge-external-systems.md) | 外部适配器版图 |
| [innoforge-on-pxn-plan.md](./innoforge-on-pxn-plan.md) | PXN 落点与已交付切片 |
| [preferences.md](./preferences.md) | 整合闭环、i18n、sim-first、设计先于开发 |

**对比媒体**（设计稿截帧 vs 现场 `/forge`，标签已标明）：

| 文件 | 内容 |
|------|------|
| `../download/cmp-design-dashboard.png` | **设计** Intent OS · 个人总览 |
| `../download/cmp-live-overview.png` | **实现** PXN `/forge` · 总览 |
| `../download/cmp-design-twin.png` | **设计** Intent OS · 项目孪生 |
| `../download/cmp-live-workbench.png` | **实现** PXN `/forge` · 工作台 |

---

## 2. 导航映射（设计 → PXN）

| Intent OS HTML | 产品设计 IA | PXN `/forge` 页 | 映射说明 |
|----------------|-------------|-----------------|----------|
| 个人总览 `dashboard` | 总览 | `overview` | 对齐 |
| 项目孪生 `twin` | 工作台 | `workbench` | 孪生+变体+Lumen 合入工作台 |
| 贡献与权益 `equity` | 权益 | `equity` | 对齐；兑现 UI 部分并入 |
| 意图与判断历史 `history` | 历史 | `history`（InnoForge） | **G3 已合入** |
| 发现项目 `discover` | 发现 | `discover` | 对齐 |
| 创建意图 `create` | 创建意图 | `create` | 对齐 |
| 确认调度 `dispatch` | 部署 | `deploy` | 部署页更丰富（制造/PXN path/3D） |
| 价值兑现 `realized` | 权益 · 价值兑现 | `equity` 价值兑现面板 | **G4 已合入** |
| — | 协作 | `collab` | InnoForge 延伸 |
| — | 市场 | `market` | InnoForge 延伸 |
| — | 账号 | `account` | InnoForge 延伸 |
| — | 外部连接 | `connections` | InnoForge 延伸 |
| — | 治理 | `governance` | InnoForge 延伸 |

---

## 3. 并排差异矩阵

图例：✅ 已对齐可演示 · ◐ 有壳/部分接线 · ❌ 设计有、实现缺或仅装饰

### 3.1 按屏

| 屏 | 设计要点 | 当前 PXN `/forge` | 判定 | 备注 |
|----|----------|-------------------|------|------|
| **总览** | Active intents · Credit/质押 · 判断声誉 · 进行中项目+权益% | 意图/Credit/质押接 API；声誉读 `accounts/me`（G5） | ✅ | G5 已合入 |
| **工作台/孪生** | 可编辑意图卡 · 约束列表 · 孪生主体 · Agent 采纳/拒绝 · 版本徽章 | **G1+G2**：约束/冻结 + 服务端判断责任链；孪生仍为 glyph | ◐ | G11 |
| **协作** | 多角色代理 · 协商裁决入责任链 · 2D/具身切换 · 操作轨迹 | R3F + SSE 房间聊天；无结构化代理冲突/裁决落库 | ◐ | G9 |
| **发现** | 项目/生命体 · Stake · 潜在权益区间 | 静态卡片 + Stake&Join→真实 create；权益区间装饰 | ◐ | G12、G7 |
| **创建意图** | 陈述 · 约束 · Credit 质押 | **G1**：多行结构化约束编辑器 + 质押 + 适配器 | ✅ | — |
| **部署/调度** | 锁定孪生版本 · 人类确认 · 资源预期 | confirm/deploy/feedback + 官方 HTTP FK path + 制造参数 + 生命体 3D + partner；缺「锁定 twin 版本」展示 | ◐ | G13（确认门控 ✅） |
| **市场** | 订阅/组件/生命体结账解锁部署 | UI + localStorage 门控；结账不扣 Credit | ◐ | G10 |
| **账号** | 演示登录 · 租户 · 支付方 · 充值 | tenant/actor 头 · sandbox · `topup` API | ◐ | Real IdP/Stripe → 外部 |
| **外部连接** | 全类目适配器 · Sim/Real | 注册表 + partner webhook 细操 ✅ | ✅ | Real Provider 凭证外部阻塞 |
| **治理** | 待审批 · 审计 · **快照回滚** | STAKED→confirm · events · SSE · **G6 快照/回滚** | ✅ | G6 已合入 |
| **权益** | 角色权重 · 质押 · 分配预览 | 权重读 API；铸造+分账行 | ✅ | G4 已合入 |
| **历史** | 判断时间线一等屏 | InnoForge `/forge` · `history` 一等屏 + timeline API | ✅ | G3 已合入 |
| **价值兑现** | 铸造额 · 角色分账展示 | 权益页「价值兑现」面板 + allocations API | ✅ | G4 已合入 |
| **生命体** | 演化提案确认/拒绝/冻结/终止 | Deploy 生命周期面板 + Discover 目录 API；提案确认/拒绝/冻结/终止 | ✅ | G7 已合入 |
| **Lumen 记忆** | 查看/忘掉/晋升共识 | 工作台模态 + API 持久化；晋升→共识约束 | ✅ | G8 已合入 |
| **i18n** | zh/en 不混排 | `i18n.js` 整页切换 ✅ | ✅ | — |
| **移动侧栏** | 可折叠 | `menu-btn` + overlay ✅ | ✅ | — |

### 3.2 按交互 / 数据流

| 能力 | 设计 | 实现 | 判定 |
|------|------|------|------|
| Credit 质押创建 | 表达有成本 | `POST /v1/forge/intents` + 账本 | ✅ |
| 人类确认后才物理出口 | 提议≠命令 | confirm→deploy 门控 + approvals 桥 | ✅ |
| Agent 变体采纳/拒绝 | 归因到判断 | **G2 已合入**：`forge_judgments` + 工作台 API | ✅ |
| 确认→PXN 调度 | 物理延伸 | bridge + robot FK + 官方 HTTP `via=http` | ✅ |
| 反馈→铸造 | 1.5× 模拟 | feedback settle + `creditMinted` | ✅ |
| 差异化分配 | 提出者/建议者/确认者 | **G4 已合入**：settle 按角色拆分铸造 | ✅ |
| 判断声誉 | 动态 | **G5 已合入**：派生 score + 租户 top% | ✅ |
| 版本锁定调度 | twin version 锁定 | 无 twin 版本实体 | ❌→G13 |
| 快照回滚 | 治理 | **G6 已合入**：snapshots + restore 补偿事件 | ✅ |
| 外部 Sim 默认 | 版图 | 27 Simulator + Real 占位 | ✅ |
| SSE 协商/治理房间 | 异步共创 | 租户作用域 SSE | ✅ |
| Partner webhook | 打样回写 | config/outbound/callback/receiver | ✅ |

### 3.3 视觉 / 体验（非阻塞原则项）

| 项 | 设计稿 | PXN | 判定 |
|----|--------|-----|------|
| 品牌 | Intent OS 侧栏 | InnoForge + Intent OS 副标 | ✅（整合） |
| 孪生主视觉 | 居中 Living Twin | glyph 占位 / R3F 在协作·部署 | ◐→G11 |
| 暗色 IA | Tailwind 面板 | 自研 `styles.css` 暗色壳 | ✅（不同系统，可接受） |
| 空态/加载/错误 | 产品要求 | toast + empty 文案 | ◐ |

---

## 4. 实现计划（有序 backlog）

**规则**：下列每一项必须先完成 §4.x 技术设计且状态 ≥ `设计完成`，经确认后才能开发。

| 顺序 | ID | 标题 | 阶段 | 状态 | 依赖 |
|------|-----|------|------|------|------|
| 1 | **G1** | 结构化约束 + 意图卡编辑/冻结 | P1 | **已合入** | — |
| 2 | **G2** | 变体采纳/拒绝 → 服务端归因责任链 | P1 | **已合入** | G1（可选并行） |
| 3 | **G3** | 意图与判断历史（独立屏或一等时间线） | P1 | **已合入** | G2 |
| 4 | **G4** | Credit 差异化分配 + 价值兑现态 | P1 | **已合入** | G2 |
| 5 | **G5** | 判断声誉（非硬编码） | P2 | **已合入** | G2、G4 |
| 6 | **G6** | 治理快照回滚 | P2 | **已合入** | G1 版本/快照 |
| 7 | **G7** | 生命体生命周期 | P2 | **已合入** | 部署反馈 |
| 8 | **G8** | Lumen 记忆持久化与管理模态 | P2 | **已合入** | — |
| 9 | **V1** | 意图树 + 场景模式 + 协作阶段 chrome（v0.4） | P1 | **已合入** | G1 |
| 9b | **F1** | 创造流程 OS 壳（分组导航·树主舞台·任务·空间·代理条） | P1 | **已合入** | V1 |
| 10 | **G9** | 协作结构化协商裁决（挂在 V1 阶段上） | P2 | **设计完成**（暂停编码，待 greenlight） | V1、G2 |
| 11 | **G10** | 市场结账扣 Credit（sandbox PaymentProvider） | P3 | 设计中 | 账号账本 |
| 12 | **G11** | 工作台孪生视觉锚（参数/GLTF 占位） | P3 | 设计中 | — |
| 13 | **G12** | 发现目录 API 化 + 权益区间 | P3 | 设计中 | G4、G7 |
| 14 | **G13** | 部署确认展示锁定孪生版本 | P3 | 设计中 | G1 |
| 15 | **G14** | Real Stripe / IdP / 公网 fab | P4 | 外部阻塞 | 凭证 |

**建议阶段**

- **P1（Intent OS 内核补齐）**：G1→G4 — 已合入  
- **P1′（v0.4 意图/协作底座）**：**V1**  
- **P2（治理与共生深度）**：G5–G8 已合入；G9 待 V1 后 greenlight  
- **P3（体验与目录）**：G10–G13 · V4–V6（见 research-system-v04-plan）  
- **P4（真实外部 / 经济）**：G14 · V7  

**下一推荐编码项**：**F2**（验证回流）或 **G9**（待 greenlight）或 **F3/V4**（组件元数据）。G1–G8 + V1 + **F1 已合入**。

---

## 4.0 V1 — 意图树 + 场景模式 + 协作阶段 chrome

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** |
| **问题** | v0.4 要求意图树一等、Product/Research/Hardware、协作 Draft→Committed；现行扁平意图 + 无阶段 chrome。 |
| **模块** | `forge-intent-tree` · migration `0008` · console 导航 `tree` · collab 阶段轨 · 场景切换 |
| **API / 数据** | `scenario`、`collab_stage`、`intent_tree`；`GET/PUT .../tree`；`POST .../tree/nodes`；`PATCH` 可改 stage/scenario。 |
| **UX** | 侧栏意图树；场景切换；协作阶段推进；zh/en。 |
| **验收** | 持久化；阶段仅前向；本地 CI。 |
| **风险** | 阶段 ≠ 部署 status；勿拆三产品。详见 [research-system-v04-plan](./innoforge-research-system-v04-plan.md) §4。 |

---

## 4.1 G1 — 结构化约束 + 意图卡编辑/冻结

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [PR #23](https://github.com/luoyanjiang/PXN/pull/23) · `main` @ `553e09e` |
| **问题** | 设计要求意图卡可编辑/冻结、约束为可管理边界；实现里约束写死或拼进 `statement`，冻结徽章不可切换。 |
| **PXN 模块** | `modules/innoforge`（`forge-loop` / `postgres-forge-loop`）· `forge-routes` · `apps/forge-console` 工作台/创建 · 可选桥接 `task_revisions` |
| **API / 数据** | migration `0025`：`constraints jsonb` + `frozen boolean`；`PATCH /v1/forge/intents/:id`；create 接受 `constraints[]`；事件 `forge.intent.updated` / `frozen` / `unfrozen`。 |
| **UX** | 创建页多行键/比较/值编辑器；工作台编辑/冻结/解冻；冻结后正文只读，变体仍可操作。 |
| **验收** | ✅ 本地 CI：`innoforge:test` 16 · typecheck · lint；媒体 `media/pxn-g1-*` |
| **风险** | 旧 intent 无 constraints → 读时从 statement `[...]` 启发式迁移或空数组；勿破坏已有 bridge PTC。 |

---

## 4.2 G2 — 变体采纳/拒绝 → 服务端归因

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [PR #24](https://github.com/luoyanjiang/PXN/pull/24) · `main` @ `50d8a7a` |
| **问题** | Adopt/Reject 仅 localStorage，不进责任链，无法支撑权益分配与历史。 |
| **PXN 模块** | `forge-judgments.ts` · `forge-loop` / `postgres-forge-loop` · `forge-routes` · workbench |
| **API / 数据** | migration `0026` `forge_judgments`（不可变）；`GET/POST .../judgments`；`GET /v1/forge/variant-candidates`；事件 `forge.judgment.recorded`；候选快照 JSON。 |
| **UX** | 工作台 API 采纳/拒绝；责任标记 actor·时间；拒绝隐藏；刷新拉服务端。 |
| **验收** | ✅ 本地 CI `innoforge:test` 18 · typecheck · lint；媒体 `media/pxn-g2-*` |
| **风险** | 勿把判断误当成物理 confirm；candidate 内容版本化若后续要做，MVP 可快照 JSON。 |

---

## 4.3 G3 — 意图与判断历史

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [InnoForge PR #1](https://github.com/luoyanjiang/InnoForge/pull/1) · `main` @ `b9acb81` |
| **问题** | Intent OS HTML 有独立「意图与判断历史」；PXN 无对等一等屏。 |
| **模块** | InnoForge `forge-console` 导航 `history` · `forge-timeline.ts` 聚合 events + judgments · in-memory / postgres loop |
| **API / 数据** | `GET /v1/forge/timeline?intent_id?` → 按时间合并 CREATED/FROZEN/JUDGMENT/CONFIRMED/DEPLOYED/SETTLED；只读。 |
| **UX** | 侧栏「历史」；时间线卡片着色（发起/架构决策/确认/部署/结算）；可按意图过滤；空态文案。 |
| **验收** | ✅ 本地 CI：`innoforge:test` 20 · typecheck；媒体 `media/innoforge-g3-zh-history.png` · `media/innoforge-g3-en-history.png` |
| **风险** | 导航变 12 项 — 移动侧栏需继续可折叠；勿中英混排标签。 |

---

## 4.4 G4 — Credit 差异化分配 + 价值兑现态

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [InnoForge PR #2](https://github.com/luoyanjiang/InnoForge/pull/2) · `main` @ `8494188` |
| **问题** | 设计要求按提出者/建议者/确认者分配；现 1.5× 整笔回提出者，权重 UI 写死。 |
| **模块** | InnoForge `forge-allocations` · settle 路径 · 权益页「价值兑现」· migration `0004` |
| **API / 数据** | 结算拆分 proposer / ADOPT suggesters / confirmer；权重 38.5 / 32 / 29.5；`forge_credit_allocations`；`GET /v1/forge/allocation-weights`；`GET .../intents/:id/allocations`。 |
| **UX** | 权益三列读配置权重；SETTLED 后同页「价值兑现」分账行；无 settled 空态。 |
| **验收** | ✅ 本地 CI `innoforge:test` 23 · typecheck；媒体 `media/innoforge-g4-zh-equity-realized.png` · `media/innoforge-g4-en-equity-realized.png` |
| **风险** | 建议者池空则权重并入 proposer；保持模拟经济，不接链上。 |

---

## 4.5 G5 — 判断声誉

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [InnoForge PR #3](https://github.com/luoyanjiang/InnoForge/pull/3) · `main` @ `18cb471` |
| **问题** | 总览「判断声誉」硬编码 **842** / 「前 8.7%」，违背「归因到判断」；无法反映 ADOPT/REJECT 与结算影响。 |
| **模块** | InnoForge `forge-reputation.ts` · `getAccount` / `GET /v1/forge/accounts/me` · `forge-console` 总览三卡 · 派生自 `forge_judgments` + intent `SETTLED` |
| **API / 数据** | 无新表。`reputation: { score, topPercent, adoptSettledCount, rejectCount, baseline }`。公式：`score = clamp(0,999, 500 + 10*adoptSettled − 2*rejects)`；`topPercent` 租户内有 judgment 的 principal 排名，**n < 2 → null**。 |
| **UX** | 总览声誉卡读 API；有 `topPercent` 显示「租户内前 X%」，否则「— · 样本不足」。已去掉 842。 |
| **验收** | ✅ 本地 CI `innoforge:test` 26 · typecheck；媒体 `media/innoforge-g5-zh-overview-reputation.png` · `media/innoforge-g5-en-overview-reputation.png` |
| **风险** | 样本稀疏时诚实空态；声誉只读派生。 |

---

## 4.6 G6 — 治理快照回滚

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** · [InnoForge PR #4](https://github.com/luoyanjiang/InnoForge/pull/4) · `main` @ `3c367fe` |
| **问题** | 产品文案含 rollback；无快照实体与恢复。 |
| **模块** | InnoForge `forge-snapshots` · migration `0005` · governance UI · 不可变事件风格 |
| **API / 数据** | `POST/GET .../snapshots`；`POST .../snapshots/:sid/restore` → `forge.intent.rolled_back` + 覆盖陈述/约束/冻结。仅 `STAKED\|CONFIRMED`；部署后 409。 |
| **UX** | 治理页「快照 / 回滚」；二次确认；`pxnTaskId` 人工提示。 |
| **验收** | ✅ 本地 CI `innoforge:test` 28 · typecheck；媒体 `media/innoforge-g6-zh-governance-snapshots.png` · `media/innoforge-g6-zh-governance-restored.png` · `media/innoforge-g6-en-governance-snapshots.png` |
| **风险** | MVP 只回滚 forge 投影。 |

---

## 4.7 G7 — 生命体生命周期

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** |
| **问题** | 设计：SETTLED 后可转生命体并管理演化；现仅 3D 装饰。 |
| **模块** | `forge_lifeforms` · deploy / equity / discover |
| **API / 数据** | `POST /v1/forge/lifeforms` from settled intent；状态 `ACTIVE\|FROZEN\|TERMINATED`；`proposals[]` `{id,summary,status}`；确认提案写 judgment 或专用事件。 |
| **UX** | 部署页生命体面板真实状态；Discover 拉 API；提案确认/拒绝。 |
| **验收** | 非 SETTLED 不可创建；提案状态可追踪。 |
| **风险** | lifeform 为产品隐喻，勿与 PXN robot asset 混淆。 |

---

## 4.8 G8 — Lumen 记忆管理

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** |
| **问题** | 记忆应可查看/忘掉/晋升共识；现仅内存气泡。 |
| **模块** | `forge_memories`（tenant+intent）· 工作台模态 |
| **API / 数据** | CRUD `/v1/forge/intents/:id/memories`；`POST .../memories/:mid/promote` → 追加 G1 constraint 或 consensus 标记 + 事件。 |
| **UX** | 「记忆」模态列表；忘掉/晋升；Lumen 回声引用 memory id（模拟）。 |
| **验收** | 刷新后记忆仍在；晋升产生可观测约束或事件。 |
| **风险** | 不接真实 LLM — 继续规则/回声模拟。 |

---

## 4.9 G9 — 协作结构化协商

| 字段 | 内容 |
|------|------|
| **状态** | **设计完成**（**暂停编码**：v0.4 先落地 V1 阶段 chrome；G9 挂在阶段上，待单独 greenlight） |
| **问题** | 多角色冲突裁决需入责任链；现为自由聊天。V1 已提供阶段轨，G9 负责 ARGUMENT/RULING。 |
| **模块** | SSE rooms + `forge_negotiations` · collab UI（消费 `collab_stage`） |
| **API / 数据** | `POST /v1/forge/negotiations` `{roles[], topic, stage?}`；消息 `kind: ARGUMENT\|RULING`；`RULING` 必含人类 `decidedBy` → 写 G2 judgment 或 `NEGOTIATION_RULED`（进 G3 时间线）。 |
| **UX** | 协商模态角色标签；「裁决」仅人类；阶段内推进 AI、跨阶段需人类。 |
| **验收** | 裁决出现在 G3 时间线；否决权配置可后置。 |
| **风险** | ruling 走 REST，聊天仍 SSE；勿在未 greenlight 时编码。 |

---

## 4.10 G10 — 市场结账扣 Credit

| 字段 | 内容 |
|------|------|
| **状态** | 设计中 |
| **问题** | 结账只置 localStorage，不经账本。 |
| **PXN 模块** | accounts topup 同源账本 · PaymentProvider sandbox · market UI |
| **API / 数据** | `POST /v1/forge/marketplace/checkout` `{sku, amount}` 扣余额、记 `MARKET_PURCHASE`、返回 `deployEligible`；服务端 `forge_tenant_flags.deploy_eligible`。 |
| **UX** | 余额不足提示充值；成功后资格与现 badge 一致。 |
| **验收** | 扣款可测；刷新资格仍在（非仅 localStorage）。 |
| **风险** | 双写 localStorage 过渡期只读服务端 flag。 |

---

## 4.11 G11 — 工作台孪生视觉锚

| 字段 | 内容 |
|------|------|
| **状态** | 设计中 |
| **问题** | 设计「孪生作为协作界面」；工作台仍为 glyph，3D 只在协作/部署。 |
| **PXN 模块** | `forge-console` · 复用 `r3f-scenes.js` 轻量 twin 场景或 2D canvas 参数预览 |
| **API / 数据** | 无强后端；可选 `intent.previewParams` from constraints。 |
| **UX** | 工作台中栏挂载只读 3D/2D 锚；不替代意图卡。 |
| **验收** | 桌面可见非纯文字占位；移动可降级静态图。 |
| **风险** | 性能 — 懒加载；遵守「非仪表盘堆砌」。 |

---

## 4.12 G12 — 发现目录 API 化

| 字段 | 内容 |
|------|------|
| **状态** | 设计中 |
| **问题** | Discover 目录写死在前端。 |
| **PXN 模块** | `GET /v1/forge/catalog` · 种子 migration |
| **API / 数据** | 项目/生命体条目含 `stakeMin`、`equityRange`；Stake&Join 继续 createIntent。 |
| **UX** | 卡片权益区间来自 API；生命体条目链 G7。 |
| **验收** | 改种子不改前端代码即变列表。 |
| **风险** | 多租户可见性 MVP=全局演示目录。 |

---

## 4.13 G13 — 部署锁定孪生版本

| 字段 | 内容 |
|------|------|
| **状态** | 设计中 |
| **问题** | Intent OS 调度页强调 Locked Twin Version。 |
| **PXN 模块** | G1 版本字段或 `revisionLabel` · deploy UI · bridge revisionId 已有则可展示 |
| **API / 数据** | confirm 时快照 `lockedRevisionLabel`（如 `TWIN v{n}` 或 `rev:...`）写入 `pxnPath` / intent；deploy 面板展示。 |
| **UX** | 对齐设计「1 AGENT PROPOSAL / 2 HUMAN CONFIRMATION」双栏信息架构可微调，不删现有 FK 展示。 |
| **验收** | CONFIRMED 后版本只读展示；与 `pxnPath.revisionId` 一致。 |
| **风险** | 文案 i18n。 |

---

## 4.14 G14 — Real Providers（外部阻塞）

| 字段 | 内容 |
|------|------|
| **状态** | 外部阻塞 |
| **问题** | Stripe 正式、公网 fab、生产 IdP 需凭证。 |
| **PXN 模块** | ExternalAdapter Real 模式 · PaymentProvider · OIDC |
| **API / 数据** | 保持 Simulator 默认；env 切换 Real；不写死厂商。 |
| **UX** | 连接页 Real 开关在无密钥时 disabled + 说明。 |
| **验收** | 有密钥沙箱联通另立切片。 |
| **风险** | 合规与密钥管理 — 另开设计。 |

---

## 5. 明确非目标（本计划不强制）

- 用 genesis Next.js 壳替换 PXN `/forge`  
- 等待 GitHub Actions 作为合并门槛  
- 未完成技术设计即开实现 PR  
- 用新经济模型覆盖 Credit 质押/铸造主路径  

---

## 6. 本轮交付清单

- [x] 并排差异矩阵（屏 / 交互 / 视觉）  
- [x] 有序 backlog + 分期  
- [x] 每项技术设计草稿（G1–G9 **设计完成**；G10–G13 **设计中**；G14 外部阻塞）  
- [x] 对比媒体 4 张  
- [x] G1–G6 已合入 InnoForge（见 §4.1–§4.6）  


---

*下一动作：G9 待单独 greenlight（挂在 V1 阶段上）；V4–V7 见 research-system-v04-plan。G1–G8 + V1 已合入。*
