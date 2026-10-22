# 按讨论文档 v0.4 改进产品与 UI

**版本**：v0.3 · 2026-10-23  
**状态**：活文档 · 与 [产品方案 v0.4](./innoforge-product-方案-v04.md)、[产品设计 v1.8](./innoforge-product-design.md)、[fidelity](./innoforge-v04-ui-fidelity-plan.md) 同步

## 源材料

- [AI创新创造研究系统_讨论文档_v0.4](./AI创新创造研究系统_讨论文档_v0.4.md)
- **产品方案（消化）**：[innoforge-product-方案-v04](./innoforge-product-方案-v04.md)
- 现行：[产品设计](./innoforge-product-design.md) · [设计 vs 实现](./innoforge-design-vs-impl-plan.md)
- 实现主仓：[InnoForge](https://github.com/luoyanjiang/InnoForge)
- 偏好：[preferences](./preferences.md)

## 目标

1. 把 v0.4 愿景/六大能力/三场景/分层架构 **整合进现行活文档**（不覆盖 Intent OS × InnoForge 闭环）  
2. **先产品方案，再 UI 设计，再技术设计/开发**（禁止跳过产品层）  
3. 对可落地项：产品方案批准 → UI 设计 → 技术设计 → 本地 CI 合入  

### 产品模型要点（v0.3）

- **Project** = 意图树 + **任务树** + 项目资产的主容器  
- **个人任务** = 跨项目 assignments **视图**，不是并列任务空间  
- **Spaces** = 资产/权限边界，不是任务看板  
- F1 顶层「任务执行 ‖ 资产空间」**产品错误**，待 UI 重设计纠正（本轮不改代码）

---

## 1. 能力映射（定稿）

| v0.4 | 现行 InnoForge | 改进方向 |
|------|----------------|----------|
| 意图层 / 意图树 | 意图卡、约束(G1)、快照(G6) | **V1** 意图树一等导航 + schema |
| 多主体协作协议 | 协作 SSE、判断(G2)；G9 裁决待做 | **V1** 阶段 chrome；G9 在阶段上做 ARGUMENT/RULING |
| 知识与组件可组合 | 市场、适配器 | V4 组件元数据与效果 |
| 仿真/原型/验证 | 部署、生命体(G7)、反馈 | V5 验证回流到树节点 |
| 贡献追踪与分配 | 声誉(G5)、分账(G4) | 项目内任务贡献 + V6 调度深化 |
| 市场化接口 | 市场、支付沙箱 | V7 资产空间 · 经济分成 |
| 硬件场景 | 制造、partner、PXN | 场景模式 HARDWARE + 远期仿真插件 |
| 任务系统 §5.6 | F1 顶层任务（**产品错误**） | **纠正**：任务∈项目；「我的任务」视图；再 V6 调度 |
| 资产/空间 §5.7 | F1 三栏 sim | 澄清为权限/资产边界；沉淀流 |
| 经济 §5.8 | Credit + 声誉 | V7 积分→真钱（不覆盖 Credit） |

---

## 2. 并排：现行 `/forge` vs v0.4 期望

| 维度 | 现行 console | v0.4 / 产品设计期望 | 差距 ID |
|------|--------------|---------------------|---------|
| 导航 | 12 项；无「意图树」；无场景模式 | 意图树一等；Product/Research/Hardware | **V1** |
| 意图表示 | 扁平 statement + constraints[] | 可版本化目标树，多人分支 | **V1**（MVP 单人树） |
| 协作 | 自由 SSE 聊天 + 3D | 阶段状态机 + 关键决策点 | **V1** chrome；**G9** 裁决 |
| 验证回流 | 反馈→SETTLED | 反馈挂回树节点 | V5 |
| 组件市场 | SKU 装饰 + 资格门控 | 效果元数据推荐 | V4 |
| 任务调度 | F1 顶层任务页（错误 IA） | **项目内**任务树 + 个人视图 | **产品方案** → UI → V6 |
| 空间 | F1 三栏 sim | 资产/权限边界（非任务空间） | UI 澄清 → V7 |
| 经济 | Credit 闭环 | + 资产分成 | V7（后置） |

---

## 3. 有序 backlog（设计先于开发）

状态：`设计中` · `设计完成` · `待开发` · `开发中` · `已合入` · `暂停/重框`

| 顺序 | ID | 标题 | 阶段 | 状态 | 依赖 |
|------|-----|------|------|------|------|
| 0 | **P-方案** | v0.4 产品方案消化（项目容器·任务归属） | P0 | **已批准** | 讨论文档 |
| 1 | **V1** | 意图树 + 场景模式 + 协作阶段 chrome | P1 | **已合入** | G1 |
| 1b | **F1** | 创造流程 OS 壳（实验） | P1 | **已合入 · 产品 IA 部分作废** | V1 |
| 1c | **U0** | UI 设计：项目中心 IA（纠正 F1） | P1 | **设计完成** → [ui-design-v04](./innoforge-ui-design-v04.md) | P-方案 |
| 2 | **G9** | 协作结构化协商裁决 | P2 | **设计完成**（待 greenlight） | V1、G2 |
| 3 | **V4 / F3** | 组件/模块元数据与效果字段 | P3 | 设计中 | 市场 |
| 4 | **V5 / F2** | 验证结果回流意图树节点 | P3 | 设计中 | V1、G7 |
| 5 | **V6** | 项目内任务树深化（调度/队列） | P3 | 待 U0 后 | P-方案、U0 |
| 6 | **V7 / F4** | 资产空间深化 + 经济分成 UI | P4 | 设计中 | U0、G4、G5 |
| 7 | **F5** | 图谱可视化 | P4 | 设计中 | V1 |
| — | G10–G14 | 见 design-vs-impl | — | 不变 | — |

**与 G9 调和**：v0.4 的「协作状态机」先以 **V1 chrome** 落地（阶段可见、可推进）；原 G9「ARGUMENT/RULING 入责任链」仍有效，但依赖阶段上下文，**本轮暂停 G9 编码**，单独 greenlight 后再做。

---

## 4. V1 技术设计（本轮实现）

| 字段 | 内容 |
|------|------|
| **状态** | **已合入** |
| **问题** | v0.4：意图树一等、三场景、协作阶段；现行无树导航、无场景、协作无阶段协议 chrome。 |
| **模块** | `forge-intent-tree.ts` · `forge_intents.scenario/collab_stage/intent_tree` · console 导航/意图树页/协作 chrome |
| **API / 数据** | migration `0008`：`scenario`、`collab_stage`、`intent_tree jsonb`；`GET/PUT /v1/forge/intents/:id/tree`；`POST .../tree/nodes`；`PATCH` intent 可改 `scenario`/`collab_stage`；事件 `forge.tree.*` / `forge.collab_stage.changed`。 |
| **树 schema** | 节点 `{id,parentId,kind:GOAL\|CONSTRAINT\|SUCCESS\|BRANCH,title,status:OPEN\|ALIGNED\|CONFLICT\|DONE}`；创建意图时从 statement+constraints 种子根 GOAL + 约束子节点。 |
| **场景** | `PRODUCT\|RESEARCH\|HARDWARE`；会话级可覆盖显示文案；意图级默认 PRODUCT。 |
| **阶段** | `DRAFT→EXPLORING→VALIDATING→COMMITTED`；仅前向推进（MVP）；协作页阶段轨 + 推进按钮。 |
| **UX** | 侧栏「意图树」；顶栏/侧栏场景切换；协作页阶段轨；创建页可选场景；zh/en。 |
| **验收** | 刷新后树/阶段/场景仍在；晋升约束可反映为树 CONSTRAINT 节点（可选同步）；本地 CI 绿。 |
| **风险** | 勿拆成三套产品；阶段 ≠ 部署 status（STAKED/…）；图谱/多人冲突不在本切片。 |

---

## 5. 本轮交付

- [x] 产品设计 v1.6 整合 v0.4  
- [x] 本计划 UI/IA 差异 + backlog  
- [x] V1 合入 InnoForge + 媒体  
- [x] 更新 design-vs-impl（V1 / G9 重框）  
- [x] **F1** 创造流程壳合入（实验；IA 纠错见产品方案）  
- [x] **产品方案 v0.4** 写完（[innoforge-product-方案-v04](./innoforge-product-方案-v04.md)）  
- [x] 产品设计 v1.8 / fidelity / 本计划：标记 F1 任务空间错误  

### 还原度诚实边界（仍未完成）

项目中心 IA（纠正 F1）· F2 验证回流 · F3 组件效果市场 · F4 经济分成 · F5 图谱 · 真图谱/对象存储/插件 · G9 裁决。

---

*下一动作：用户批准 UI 设计 → 技术设计（对照 UI §7）→ 实现。产品方案已批准；UI 设计已完成。本轮无代码。*
