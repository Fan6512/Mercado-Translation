# Architecture

本文档记录 Mercado-Translation 当前的长期架构边界、模块职责、数据流和维护原则。

## 设计目标

这个项目的目标不是做成通用前端框架应用，而是保持：

- 本地直接运行。
- Windows 用户双击即可启动。
- `file://` 兼容。
- 无常驻 Node / Python 服务。
- 不依赖 bundler 才能运行。
- 代码结构清晰到可以持续维护。

因此采用“中等粒度经典脚本架构”，而不是单文件巨石，也不是大量 ES Module 小文件。

## Runtime 结构

```text
index.html
  │
  ├─ tailwind.min.css
  │
  ├─ src/core/config.js
  ├─ src/api/provider-adapters.js
  ├─ src/api/client.js
  ├─ src/translation.js
  └─ src/app.js
```

加载顺序有依赖关系，不应随意交换。

## 模块边界

### index.html

只负责：

- HTML 结构。
- 表单和按钮。
- 输出区域。
- CSS 引用。
- `<script src>` 加载顺序。

不再放大段业务 JavaScript。

### src/core/config.js

配置和持久化模型层。

包括：

- `DEFAULT_GLOBAL_PROMPT`
- `STORE`
- Profile presets
- schema version
- Profile normalize / migration
- active profile 查询
- localStorage 配置读写

该文件是数据兼容边界。

如果未来新增 Profile 字段，应优先在这里处理默认值和迁移。

### src/api/provider-adapters.js

Provider / model compatibility layer。

职责：

```text
Profile + options
      ↓
buildChatRequest()
      ↓
兼容后的请求 body
```

这里解决协议“长得差不多但参数略有区别”的问题。

当前处理：

- `max_tokens`
- `max_completion_tokens`
- temperature 支持差异
- Provider 基础识别
- generic fallback

它不负责：

- fetch
- retry
- SSE
- UI
- Prompt

### src/api/client.js

网络基础设施层。

负责：

- Base URL
- HTTP prefix proxy
- timeout gate
- AbortController
- retry decision
- exponential backoff
- Retry-After
- SSE parsing
- JSON response handling
- `callAI`
- 通用 JSON API 请求

网络行为应该集中在这里。

### src/translation.js

翻译领域逻辑层。

适合放“与 DOM 无关、与 HTTP 无关”的翻译辅助逻辑，例如：

- 字符计数
- Prompt 注释过滤
- Route Prompt 构造
- 标题字符限制辅助判断

目标是让这部分代码以后可以独立测试，而不用模拟页面。

### src/app.js

应用编排层。

负责：

- DOM
- Profile UI
- Toast
- Google 预检交互
- 主翻译事件
- 双路并发 orchestration
- 压缩确认交互
- 输出渲染
- History UI
- 配置导入导出 UI
- 利润计算器 UI

`app.js` 可以相对较大，因为它本来就是页面控制器。

如果未来它再次膨胀到难以维护，再优先按“大职责”拆，而不是按单个函数拆。

## 翻译数据流

```text
用户输入
  ↓
读取 active Profile
  ↓
构造 system/session Prompt
  ↓
buildRoutePrompt()
  ↓
┌────────────────┬────────────────┐
│ Route A         │ Route B         │
│ EN + ZH         │ ES + PT         │
└───────┬────────┴────────┬────────┘
        │                 │
        ↓                 ↓
      callAI()          callAI()
        │                 │
        └──────┬──────────┘
               ↓
             merge
               ↓
        完整性 / 字符校验
               ↓
          可选压缩复检
               ↓
             History
```

## 部分失败语义

一次翻译不是“只要有内容就是成功”。

状态语义：

```text
Complete
四语都有 title
→ 正常完成

Partial
只有部分语种成功
→ 页面保留已有结果
→ 显示错误
→ 不压缩
→ 不写历史

Failed
没有有效结果
→ 整体错误
```

这是重要业务契约。

## 请求模型

### callAI

`callAI()` 是 AI 网络请求的统一入口。

逻辑结构：

```text
outer retry loop
  ↓
requestOnce()
  ↓
fetch
  ↓
SSE / JSON
  ↓
JSON parse
```

重试发生在外层，单次 HTTP 行为留在 `requestOnce()`。

### Provider Adapter

调用链：

```text
callAI()
  ↓
ProviderAdapters.buildChatRequest()
  ↓
fetch('/chat/completions')
```

不要绕开 adapter 手工生成另一套请求 body。

## SSE 设计

SSE 以完整 event 为单位解析：

```text
data: {...}

```

而不是假设一个 TCP chunk 对应一行或一个 event。

parser 必须允许：

- chunk 跨 event。
- event 跨 chunk。
- CRLF。
- 多行 data。
- EOF 尾部 event。

如果未来要支持其它流式协议，建议新建 parser，而不是往当前循环里大量塞 provider if。

## Timeout 设计

使用 idle timeout。

```text
request starts
   ↓
timer
   ↓
headers arrive → reset
   ↓
SSE chunk → reset
   ↓
SSE chunk → reset
```

这是为了兼容长时间生成。

固定总请求超时不适合当前 AI 流式场景。

## Retry 设计

自动重试表示“这次请求可以安全重放”。

允许自动重放：

- 429
- 5xx
- 请求尚未返回内容的网络失败

不允许：

- 普通客户端错误
- cancel
- timeout
- 已收到模型文本后的中断

最后一条尤其重要，因为重新发送会产生第二份不同的生成结果。

## 数据持久化

应用数据全部在 localStorage。

主要 Key 是稳定接口：

```text
translator_profiles_v1
translator_global_prompt_v1
translator_history_v1
translator_calc_params_v1
translator_fast_mode
translator_calc_floating_state
```

### Schema migration

数据模型变更遵循：

```text
读取旧数据
  ↓
normalize / migrate
  ↓
得到当前结构
  ↓
必要时重新落盘
```

不要用破坏式 schema 修改。

## 安全模型

### 默认模式

默认 Chrome 启动器不开 `--disable-web-security`。

### 兼容模式

兼容模式只是旧 API / CORS 场景兜底，不是默认路径。

### 第三方运行时脚本

因为页面持有 API Key，尽量保持：

```text
运行时代码 = 仓库内已审核代码
```

因此 Tailwind 改成本地编译 CSS，而不是 runtime CDN。

## CSS 构建

Tailwind 不是应用运行依赖，只是开发时生成静态 CSS 的工具。

输入：

```text
tools/tailwind-input.css
index.html
src/**/*.js
```

输出：

```text
tailwind.min.css
```

运行应用时不需要安装 Node。

## 为什么不用 ES Modules

现代 Web 项目一般推荐 ES Modules，但这里暂时保留经典脚本有现实原因：

- `file://` 是正式支持场景。
- 用户不运行开发服务器。
- 项目规模有限。
- 当前依赖关系简单且稳定。

如果未来产品形态变成服务器托管 Web App，再重新评估 ESM / bundler。

## 为什么不继续细拆

下面这些当前不单独拆：

```text
Toast
History
Calculator
Profile UI
Import dialog
Output cards
```

原因：

- 它们都高度依赖 DOM。
- 只被当前页面使用。
- 文件间通信成本会超过维护收益。

模块化目标是减少认知负担，不是最大化文件数量。

## CI

CI 属于架构的一部分。

主要保护：

```text
JS syntax
script structure
Tailwind local build
no runtime Tailwind CDN
default browser security
SSE invariants
partial result behavior
history completeness guard
```

架构调整时，CI 断言也必须同步更新。

## 推荐开发流程

```text
1. 从稳定分支创建 feature/refactor branch
2. 修改对应职责模块
3. node --check 所有 JS
4. 需要时重建 Tailwind
5. python tools/validate_app.py
6. 提交
7. PR
```

较大的重构不要直接修改 `main`。

## 文件归属原则

遇到新代码时按以下问题判断：

```text
是数据结构 / 配置兼容？
→ core/config.js

是模型 API 参数差异？
→ provider-adapters.js

是 HTTP / streaming / retry？
→ api/client.js

是翻译领域纯逻辑？
→ translation.js

是 DOM / 页面操作流程？
→ app.js
```

如果一个新功能横跨多层，每层只承担自己的部分，不要为了省文件往 `app.js` 里重新堆网络或 schema 逻辑。

## 架构变更标准

只有满足以下至少一个条件，才建议增加新模块：

- 一个职责超过约 300-500 行并持续增长。
- 存在可独立测试的稳定接口。
- 被多个模块重复使用。
- 有明确生命周期或依赖边界。

否则优先留在现有模块。
