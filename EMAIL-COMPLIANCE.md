# 邮件发送合规与防退信加固（2026-11-23）

## 一、真实退信原因（已修复）

Gmail 退信原文：
```
550-5.7.1 Messages missing a valid Message-ID header are not accepted.
review RFC 5322 specifications ... gsmtp
```
**根因**：raw 模式发信（`sendMail({raw})`）下 nodemailer 不生成任何头，
我们的 EML 生成器缺少 Message-ID。已修：生成 RFC 5322 合规的
`<hex@from-domain>` 头（域名必须与 From 一致）+ Date 头。

## 二、Gmail 官方发送规则（研究结论）

来源：support.google.com/a/answer/81126（Email sender guidelines）、
14016360（header limits）、3726730（SMTP 错误码）

**格式合规（RFC 5322）**：
- 每封必须有有效 Message-ID（长度≤500 字符）
- From/To/Subject/Date 是单实例头，**只能出现一次**
- From 只能有一个邮箱地址；显示名不能含主题/营销词/收件人名字
- Subject 长度 ≤998 字符；单个头值 ≤32KB；总头 ≤500KB

**认证（DMARC 对齐）**：
- From 域名必须与 SPF 或 DKIM 认证域名对齐（否则 550 5.7.32 直接拦截）
- 421 4.7.27 SPF 失败 / 4.7.30 DKIM 失败 / 4.7.40 缺 DMARC 记录
- 发信 IP 需有 PTR 反向 DNS（4.7.23）

**群发规则（每天 ≥5000 封到个人 Gmail）**：
- 必须 SPF + DKIM + DMARC 全套
- 营销邮件必须支持**一键退订**（RFC 8058，List-Unsubscribe-Post + List-Unsubscribe）
- 垃圾邮件率必须 <0.3%
- 2024-02 起强制，2025-11 起加大执法（临时/永久拒收）

**我们的规模**：单批 1344 封，低于 5000 门槛，但接近；格式合规必须做到位。

## 三、本次加固内容

1. **Message-ID + Date 头**（已修，见上）
2. **发信前自检 `validateRawEmail`**：
   - 必需头齐全（From/To/Subject/Date/Message-ID）
   - 单实例头不重复
   - Message-ID 格式合法 + 域名与 From 一致
   - 占位符邮箱（[email protected]、@example.com）直接拦截
   - 接入 `sendRaw` 统一入口——所有 raw 发信都过这道关卡，本地快速失败，
     不再浪费 SMTP 往返和等退信
3. **批量发送过滤占位符邮箱**：从 eligible 阶段排除，避免"无收件人"失败
4. **退信原因分类补全**：新增 Message-ID 缺失、DMARC 对齐、SPF/DKIM
   失败、PTR 缺失、一键退订缺失等规则，且放在泛化 5.7. 之前优先匹配；
   535 单独识别为"授权码错误"（不再是笼统的"认证失败"）

## 四、法律合规待办（未做，需决策）

以下是 CAN-SPAM（美国）/ GDPR（欧盟）对商业邮件的要求，**当前系统存在缺口**：

| 要求 | 法规 | 现状 | 建议 |
|---|---|---|---|
| 真实发件人身份 + 有效物理地址 | CAN-SPAM | 通过发信人档案部分满足；缺物理地址 | 在签名模板加公司地址字段 |
| 有效退订机制（30 天内生效） | CAN-SPAM / GDPR | ❌ 无退订系统 | 建退订端点 + 抑制列表 + 每封邮件带 List-Unsubscribe |
| 收件人同意（opt-in） | GDPR | ❌ 名录来源无同意记录 | 记录每家公司邮箱来源与获取时间，保留可追溯证据 |
| 一键退订（≥5000/天） | Gmail 规则 | ❌ 无 | 实现 RFC 8058 头 + POST 端点 |
| 数据主体删除权 | GDPR | ❌ 无 | 退订即加入抑制列表，不再发送 |

**注意**：曾尝试加 `List-Unsubscribe: mailto:发件人自己`——已撤销。
指向发件人邮箱的退订请求无人处理，是**虚假退订机制**，比不加更糟
（法律上仍不合规）。要做就必须做完整：独立退订端点 + 抑制列表 + 每封唯一 token。

## 六、退订系统（2026-11-23 已实现）

按 RFC 8058 + CAN-SPAM + GDPR 实现：

- **email_suppressions 表**：邮箱唯一，原因（user/bounce/manual），即时生效
- **HMAC 签名 token**：`base64url(email).hmac`，不含明文邮箱，不可伪造，
  timingSafeEqual 验证（与忘记密码同一防御）
- **两个公开端点**：
  - `GET /api/unsubscribe?token=...` —— 邮件链接点进来直接退订 + 中文确认页
  - `POST /api/unsubscribe/one-click?token=...` —— RFC 8058 一键退订
    body 固定 `List-Unsubscribe=One-Click`，无登录/cookie 要求，不重定向
- **EML 头**：每封按收件人生成唯一 token 的 HTTPS 退订 URL，
  写入 `List-Unsubscribe` + `List-Unsubscribe-Post`
- **发送拦截**：batchSend 一次查完抑制名单；单封发送也检查——退订的绝不发送
- **管理 UI**：设置 → 发信服务 → 退订名单，可查看/移除（重新订阅）

**限制（坦诚说明）**：RFC 8058 要求 DKIM 签名覆盖这两个头。我们用第三方 SMTP，
DKIM 由服务商签名，无法控制是否覆盖 → 部分邮件客户端可能不显示"一键退订"按钮，
但 HTTPS 退订链接始终有效，用户点链接即可退订（满足 CAN-SPAM "有效退订机制"）。

**仍待办**：收件人同意（opt-in）证据记录——需在当前导入流程里保存
"邮箱来源/获取时间/来源 URL"，用于 GDPR 审计。

## 五、验证

- validateRawEmail 单测：合规邮件 PASS；缺头/域名不一致/占位符邮箱均正确拦截
- 线上 EML 实测：Message-ID `<...@dreamloom.co.uk>` 与 From 同域、Date 头存在
