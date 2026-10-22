# InnoForge 外部系统版图

**原则**：物理 AI 不只「自己对接一台设备」，而是通过**统一执行网关 + 可插拔适配器**对接一整类相关外部系统。当前一律 **接口占位 + 模拟实现**；有真实凭证时再切换 Provider。

## 为什么要多系统

闭环是：意图 → 协商确认 → **物理执行与供应链** → 反馈 → 兑现。  
数字侧需要模型/工具/身份；物理侧需要制造、物流、传感；商业侧需要支付与合规。系统必须可扩展对接，而不是写死一家厂商。

---

## 1. 物理执行与制造

| 系统类型 | 做什么 | 示例形态 |
|----------|--------|----------|
| CNC / 机床控制 | 下发刀具路径、工单、状态回传 | 厂商 OPC-UA / MTConnect / 私有 API |
| 3D 打印 / 增材 | 切片任务、材料、打印队列 | OctoPrint、Bambu、厂商云 |
| 打样 / 柔性制造平台 | 小批量下单、报价、交期 | 第三方 fab API |
| MES / 工单系统 | 工单、工序、在制 | 工厂 MES |
| 机器人 / 机械臂 | 抓取、装配、产线节拍 | ROS 2、厂商 SDK |
| IoT / 传感与边缘 | 温振、视觉质检、设备心跳 | MQTT、边缘网关 |
| 数字孪生 / PLM·CAD | 几何与 BOM、版本、DFM | CAD/PLM 导出、STEP/GLTF |

**原型**：`partner-http` + 本地 webhook 仿真接收器（接口占位）；注册表 `mfg-*`。

---

## 2. 供应链与履约

| 系统类型 | 做什么 |
|----------|--------|
| 原材料 / 零部件供应 | 询价、库存、交期 |
| 物流与仓储（WMS/TMS） | 发货、追踪、入库 |
| ERP | 订单、成本、库存主数据 |
| 质量 / 实验室（QMS） | 检验结果回写意图与生命体 |

**原型**：Deploy 进度与供应链信号用模拟事件；`sc-*` Simulator。

---

## 3. 智能与工具（数字侧）

| 系统类型 | 做什么 |
|----------|--------|
| 大模型 / Agent 运行时 | 变体生成、协商代理、Lumen |
| 向量 / 记忆存储 | 伙伴长期记忆、项目共识 |
| 仿真与有限元 / DFM | 可制造性与强度预检 |
| 代码与 CI（可选） | 固件/控制脚本发布到边缘 |

**原型**：本地 mock Agent；记忆存本地/云端快照；`intel-*`。

---

## 4. 身份、协作与治理

| 系统类型 | 做什么 |
|----------|--------|
| IdP / SSO（OIDC/SAML） | 人与租户身份 |
| 企业目录 / SCIM | 成员与角色同步 |
| 审计 / SIEM | 责任链外发合规存证 |
| 即时协作（可选） | 通知人类确认（邮件/Slack 等） |

**原型**：演示登录 + 租户会话；SSE 房间模拟多人；`id-*`。

---

## 5. 商业与权益

| 系统类型 | 做什么 |
|----------|--------|
| 支付（Stripe 等） | 订阅、打样费、Credit 充值 |
| 税务 / 发票 | 合规开票 |
| 组件 / 生命体市场目录 | 第三方组件上架（可双向） |
| 账本 / 结算（可选链上） | Credit 铸造与归因存证增强 |

**原型**：`PaymentProvider` sandbox / stripe-test；市场为本地目录；`com-*`。

---

## 6. 运行与观测

| 系统类型 | 做什么 |
|----------|--------|
| 对象存储 | 模型、切片、审计附件 |
| 密钥管理（KMS） | 厂商密钥与 webhook 签名 |
| 可观测性 | 任务与适配器延迟/失败 |
| 密钥保险库 / Secrets | 按租户隔离外部凭证 |

**原型**：`.data/` 本地落盘；密钥走环境变量占位；`ops-*`。

---

## 对接架构（约定）

```
InnoForge 核心闭环
    └── 受控物理执行网关（统一任务 / 审批 / 回写）
            └── External Adapter Registry（统一合同）
                    ├── manufacturing: CNC / 打印 / 打样 / MES / 机器人 / IoT / 孪生
                    ├── supply_chain: 供应 / 物流 / ERP / QMS
                    ├── intelligence: LLM / 记忆 / DFM / CI
                    ├── identity: IdP / SCIM / SIEM / 通知
                    ├── commerce: 支付 / 税务 / 市场目录 / 账本
                    └── observability: 对象存储 / KMS / OTel / Secrets
```

每个 Adapter：**同一接口**（createJob、getJob、cancelJob、health、可选 tick）+ **Simulator 实现**（默认）+ **Real 实现**（有凭证时启用，如 `STRIPE_SECRET_KEY`、`EXTERNAL_FAB_REAL`）。

人类主权不变：进入真实外部系统前仍经 Governance 确认。

## 与代码的对应（当前）

| 能力 | 占位位置 |
|------|----------|
| **统一注册表** | `src/lib/external/*`、`GET/POST /api/external`、UI `/connections` |
| 制造 / 打样 | `mfg-*`；`/api/gateway`、`partner-http`、webhook receiver |
| 供应链 | `sc-*` Simulator；Deploy 调度时创建物流模拟任务 |
| 智能 | `intel-*`；本地 Agent / 记忆快照 |
| 身份 | `id-idp` + `/account` 演示会话、租户作用域 |
| 支付 / 商业 | `com-payment` ↔ `PaymentProvider` sandbox / stripe-test；`com-market` |
| 观测 | `ops-*`；`.data/` 落盘 |
| UI | 侧栏「外部连接」；Account / Deploy 摘要面板（状态=模拟） |
