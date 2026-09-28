# BD 邮件生成系统 - 研发规范

## 应用概览

塞尔维亚餐厅 BD 商务拓展邮件生成系统。用户上传餐厅名录 Excel，系统自动抓取餐厅官网、理解餐厅信息，结合用户维护的项目资料，通过 AI 模型生成个性化合作邀约邮件，最后一键跳转到企业微信写信窗口。

## 导航与页面

- 工作台（首页 `/`）：统计卡片 + 餐厅表格 + 筛选搜索 + 展开详情 + 导入入口
- 项目资料（`/projects`）：项目资料 CRUD，含图片上传与预览
- 模型设置（`/settings`）：API 配置 + 测试连接 + 署名签名

## 后端模块

| 模块目录 | 路由前缀 | 职责 |
|---------|---------|------|
| `restaurants` | `/api/restaurants` | 餐厅名录 CRUD、Excel 导入解析、状态管理 |
| `projects` | `/api/projects` | 项目资料 CRUD、图片管理 |
| `model-config` | `/api/model-config` | 模型 API 配置存储与测试连接 |
| `website-analyzer` | `/api/website-analyzer` | 网站抓取与内容理解 |
| `email-generator` | `/api/email-generator` | 邮件生成（调用模型 API） |

## 数据库表

1. `restaurants` — 餐厅名录（Excel 导入字段 + 状态 + 网站摘要 + 生成的邮件）
2. `projects` — 项目资料（名称 + 简介）
3. `project_images` — 项目图片（file_attachment 类型）
4. `model_config` — 模型 API 配置（单条记录）

## 设计规范

### 色彩
- 主色：蓝色系 `bg-primary`（专业商务感）
- 背景：浅灰白 `bg-slate-50`
- 卡片：纯白 + 轻微阴影

### 间距
- 页面内边距：`p-6`（桌面）/ `p-4`（移动端）
- 卡片内边距：`p-5`
- 区块间距：`gap-6`
- 表格行内元素间距：`gap-2`

### 排版
- 页面标题：`text-2xl font-bold`
- 卡片标题：`text-lg font-semibold`
- 正文：`text-sm text-slate-600`
- 辅助文字：`text-xs text-slate-400`

### 组件规范
- 按钮：shadcn Button，主要操作用 `variant="default"`
- 表格：antd-table，支持分页、排序
- 弹窗：shadcn Dialog
- 输入：shadcn Input / Textarea
- 提示：sonner toast


