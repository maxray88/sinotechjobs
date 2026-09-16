# Impressum / Datenschutz — TODO 清单（德国 GmbH 待办）

> 状态：草稿待办（2026-09-16）。`004_matching_legal.sql` 种子仅为**简版占位**，上线前须由律师审定全文。
> 设计依据：design doc §7（7.1 Jobbörse 非 Vermittlung、7.2 GDPR、7.3 PIPL、7.4 三语法律文档、7.5 EU Pay Transparency）。
> 占位符 `[…]` 必须在发布前全部替换为真实信息。

## 1. Impressum（Impressumspflicht，§5 DDG / Art. 5 E-Commerce-RL）

- [ ] 公司全称 + 法律形式（… GmbH）
- [ ] 注册地址（街道、邮编、城市；不能仅用邮政信箱）
- [ ] Geschäftsführer（总经理姓名）
- [ ] Handelsregister：HRB 编号 + 注册法院（Amtsgericht …）
- [ ] USt-IdNr.（DE…，§27a UStG；如无则写申请中）
- [ ] 联系方式：电话 + 邮箱（须可实际联系到）
- [ ] 内容负责人（§18 MStV）：姓名 + 地址
- [ ] Impressum 页面全站可达（Footer 链接，≤2 次点击），德语版优先，三语一致
- [ ] Mini Program / WeChat 公众号内同步公示运营主体

## 2. Datenschutzerklärung（GDPR Art. 13/14）

- [ ] 控制者信息（同 Impressum + `datenschutz@…` 邮箱）
- [ ] DPO：是否需要指定 Datenschutzbeauftragter（>20 人常态处理个人信息则强制）；如指定则公示联系方式
- [ ] 数据清单：账户、简历（含 CV、语言、签证状态）、职位、匹配分、通知、日志
- [ ] 每一类数据的目的 + 法律依据（Art. 6(1)(a)/(b)/(f)）
- [ ] 接收方：可见简历的雇主（仅 visible=Fluoroscopy 公开）、子处理者（Vercel、Supabase，EU 区域；列出 DPA 链接）
- [ ] 存储期限：注销即匿名化简历；财务记录保留 7 年（Aufbewahrungspflicht）
- [ ] 用户权利：查阅/更正/删除/限制/可携带/反对/撤回 + 投诉监管机构（注明所属州 Landes-DSB）
- [ ] Cookie/追踪：技术必要 Cookie 清单；Plausible/分析工具启用前补同意横幅（consent banner）
- [ ] 未成年人条款（如允许 <16 岁注册须监护人同意流程，否则写明 16+）
- [ ] 由 IT-Recht-Kanzlei 或同等机构审定全文（预算见 design §10：约 €500–1,000 一次性）

## 3. ToS 定稿（§7.1 核心声明必须保留）

- [ ] 保留并加粗：*"Jobbörse, keine Vermittlung — keine Vermittlung von Arbeitsverhältnissen, keine Erlaubnis nach §1 GewO"*（三语种子已有，律师版不得删除）
- [ ] 薪资必填规则（§7.5 EU Pay Transparency：所有职位须含最低薪资，2026-06 指令大限前已生效）
- [ ] 雇主广告合规责任条款 + 违规下架流程
- [ ] 变更通知期 14 天 + 版本号/生效日更新流程（`legal_documents.version`）
- [ ] `user_acceptances` 表（如需接受记录）：本迁移未建表，需要时另起 005 迁移

## 4. DPA + Cookie（§7.2/7.4 剩余文档）

- [ ] Auftragsverarbeitungsverarbeitung (AV-Vertrag)：与 Vercel/Supabase 签署；面向雇主的 DPA 模板（雇主可见简历即为处理者链条）
- [ ] `cookie_policy` 全文种子（`legal_documents` type 已预留，内容待补）
- [ ] `dpa` 全文种子（type 已预留，内容待补）
- [ ] Cookie 同意横幅前端实现 + 撤回入口（与隐私政策 §6 对应）

## 5. PIPL（§7.3，中国候选人）

- [ ] ToS 保留"DACH 地区"范围声明（种子已有）
- [ ] 中国大陆注册链路：单独的跨境传输同意弹窗 + 日志留存
- [ ] v2 评估：香港节点（阿里云/腾讯云）隔离中国用户数据——决策 + 时间表

## 6. 发布前检查

- [ ] 所有 `[PLACEHOLDER]` 已替换（grep 确认 `legal_documents` 种子无方括号残留）
- [ ] `/imprint`、`/privacy`、`/terms` 三语页面上线并链接种子版本
- [ ] 删除权端到端验证（注销 → 匿名化确认查询）
- [ ] npx tsc --noEmit 通过；未执行任何 DB 写入（本清单 + 004 均为文件交付）
