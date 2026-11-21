# Token 优化空间分析（基于 2026-11-20 实际数据）

## 一、先明确：token 浪费的三个层次

从 `batch-diagnose` 查到的真实数据：

```
failed=599 / total=547   ← 失败数超过总数，重复处理约 5 轮
401 次失败全因："模型服务持续不可用超过 5 分钟（HTTP network）"
**实测确认真因**：直接调中转返回 `This token quota is exhausted TokenStatusExhausted`
——即 **API Key 额度耗尽**。该错误是 api_error 无标准 HTTP 状态码，
旧正则只匹配 `quota exceeded` 不匹配 `quota is exhausted`，被误判为网络故障
反复重试 5 分钟 × 6 组并发。（已修：正则补 `quota (is )?exhausted`）
```

**层次 1（已修，占浪费大头）**：失败项不记忆 → 每轮重跑同一批失败公司 → 5 倍浪费。已加 `failed_ids` + 熔断，此源头已堵住。

**层次 2（本次修）**：`done` 计数 bug 导致显示错乱（不影响 token，但影响判断）。

**层次 3（本报告主题）**：单次请求内部的结构性重复。这是"正常运行时"的优化空间。

---

## 二、量化：一封邮件的 token 构成

从代码实际测量：

| 段 | 字符数 | ≈ tokens | 每封都发？ |
|---|---:|---:|---|
| system prompt（写作规则 13 条） | 3,126 | ~890 | ✅ 每封完全相同 |
| user prompt 的 PROCESS 规则段 | 2,612 | ~750 | ✅ 每封完全相同 |
| SENDER 段（姓名/职位/邮箱/介绍） | ~600 | ~170 | ✅ 同用户下完全相同 |
| 项目描述 WHAT WE OFFER | 变化 | ~100-300 | ✅ 同项目下完全相同 |
| 图片描述列表 | 变化 | ~50-400 | ✅ 同项目下完全相同 |
| 公司信息（唯一变量） | ~400 | ~120 | 唯一 |

**结论：每封约 2,000 tokens 的输入里，只有 ~120 tokens（6%）是公司特有的；94% 是重复内容。**

547 封邮件 ≈ 547 × 2,000 = **109 万输入 tokens，其中约 103 万是重复的**。

---

## 三、可行优化方案（按收益/风险排序）

### 方案 A：Prompt Caching（Anthropic / OpenAI 都支持）

**做法**：把 system prompt + PROCESS 规则 + SENDER 段 + 项目描述做成**固定的前缀**，标记为 cache。同一批 547 封只有公司信息是变化后缀。

- Anthropic：在固定段末尾的消息上加 `cache_control: {type: 'ephemeral'}`
- OpenAI：自动 prompt caching（相同前缀自动命中，缓存 5-10 分钟）

**预期收益**：
- 命中后重复段按 **10% 计费**（OpenAI）/ **10%（Anthropic 缓存读）**
- 每封从 ~2,000 tokens 降到 ~200-300 有效 tokens
- **约节省 85-90% 输入 token 成本**，547 封省约 90 万 tokens
- 输出不变 → **结果准确性零影响**

**可行性**：高。当前 aixapex 中转支持 OpenAI 格式；`buildChatBody` 已集中构造请求体，改动面小。
**风险**：中转是否透传 `cache_control` 未知，需要实测；但 OpenAI 自动缓存无需改请求体，只要**保证固定段字节级一致**（目前模板是常量，天然一致）。

**建议**：**优先做**。先验证中转是否自动命中缓存（看响应里的 `usage.prompt_tokens_details.cached_tokens`），命中就是零代码收益。

### 方案 B：公共上下文请求期缓存（减少 DB 查询，不直接省 token）

**做法**：在 `processBatch` 开始时一次性读取并缓存：
- `projectContext`（项目描述、素材列表）
- `sender` / `senderConfig` / `personalStory`
- `senderProfile` 的 `introEnabled/introContent`
- `modelConfig`（apiKey/baseUrl/model）
- `getEmailImageCandidates` 的图片描述列表（已有 DB 缓存，但每封都重查）

当前每家公司都重复查 5-6 次 DB（见 generateEmail 第 217-225 行）。547 封 ≈ 3,000 次重复查询。

**预期收益**：
- 不直接省 AI token，但**大幅减少 DB 往返**（批量耗时可降 10-20%）
- 避免因项目信息中途被改导致 547 封邮件风格不一致（快照语义）
- 图片描述 map 构造从 547 次降到 1 次

**可行性**：高。用 batch-level context 对象传给 `generateEmail(id, userId, sharedCtx)`，可选参数、向后兼容。
**风险**：项目信息在批量运行中变更时，本批用旧快照——需要明确这个语义（其实这正是用户之前要的"以发起时的配置为准"）。

### 方案 C：双版本生成合并为一次调用

**现状**：每家公司生成 local + English **两个完整版本**，prompt 要求"Generate TWO complete versions"。

**做法不改**：这是产品需求，不能砍。但可以：
- 让模型先写 local 版，再由模型翻译（两次调用，但每次更短）→ **不会更省**，放弃。
- 保持单次调用——当前策略已是最优。

**结论**：无明显收益，不建议动。

### 方案 D：失败重试策略优化（已部分做）

内层 `ai-chat` 每个暂时性错误等 3 秒、最多 5 分钟。已加熔断（连续 5 次停）。
可再优化：**指数退避**（3s→6s→12s→24s）替代固定 3 秒，减少无效重试次数：
- 5 分钟内固定间隔 = 100 次重试
- 指数退避 = ~10 次
- **在服务短暂抖动时省 90% 重试调用**

**可行性**：中。改 `ai-chat.ts` 的 `RETRY_INTERVAL_MS` 逻辑，加 `Math.min(30000, 3000 * 2^attempt)`。
**风险**：低，只影响失败路径。

---

## 四、推荐实施顺序

1. **立即验证 A 的"零改动收益"**：查一次实际响应的 `cached_tokens`，如果中转自动缓存，什么都不用改就省 85%。
2. **做 A 的显式缓存控制**（如果中转不自动）：固定段用 `cache_control`，改动 `buildChatBody` 加可选 `cachePrefix` 参数。
3. **做 B**：batch-level context 缓存（顺便提升一致性）。
4. **做 D**：指数退避（防御性）。

**预计综合收益**：正常运行下输入 token 降低 **~85%**，批量耗时降低 **~15%**，模型故障时无效重试降低 **~90%**。所有方案均不改变 prompt 内容语义，结果准确性不受影响。

---

## 五、明确不建议做的

- ❌ 减少 system prompt 规则条数——规则是邮件质量的保障，省这点 token 不值得
- ❌ 砍掉双版本——产品需求
- ❌ 图片描述不预生成——已有 DB 缓存，再省会牺牲选图质量
- ❌ 公司信息模板化——正是"个性化"的核心，不能省
