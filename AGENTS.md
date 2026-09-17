# AGENTS.md

给未来在这个仓库工作的 AI 助手（Claude、Codex、Cursor、Copilot 等）的维护指南。

> 文档分工：`README.md` 面向用户和普通开发者；本文件面向 AI/维护者；`docs/ARCHITECTURE.md` 记录长期架构边界与演进原则。

## 项目定位

这是一个轻量级本地前端应用：

- 不需要 Node 运行时启动。
- 不依赖开发服务器。
- 不使用 React / Vue / Vite / Webpack。
- 通过经典 `<script src>` 顺序加载 JavaScript。
- 必须继续兼容 `file://` 本地运行。
- Windows 下支持 Chrome 启动器和 Pake 桌面打包。

项目已经从“单文件 HTML”重构成中等粒度模块结构。不要再把全部 JS 塞回 `index.html`，也不要为了模块化继续拆成大量极小文件。

## 当前架构

```text
index.html
  ↓
src/core/config.js
  ↓
src/api/provider-adapters.js
  ↓
src/api/client.js
  ↓
src/translation.js
  ↓
src/app.js
```

职责：

| 文件 | 责任 |
| --- | --- |
| `index.html` | HTML/UI 骨架、样式引用、脚本加载顺序 |
| `src/core/config.js` | Prompt、STORE、Profile schema、配置持久化和迁移 |
| `src/api/provider-adapters.js` | Provider / model 请求参数差异 |
| `src/api/client.js` | HTTP、代理、超时、取消、重试、SSE、AI 调用 |
| `src/translation.js` | 字符计数、Prompt 清理、多语路由等领域辅助逻辑 |
| `src/app.js` | UI 渲染、事件绑定、翻译主流程、历史和页面 orchestration |

这是刻意选择的中等粒度。除非某块逻辑已经明显独立且持续膨胀，否则不要再拆 Toast、History、Calculator、Profile UI 等小模块。

## 安全原则

### Tailwind

运行时禁止重新引入：

```text
https://cdn.tailwindcss.com
```

当前使用本地 `tailwind.min.css`。

如果 UI 或 JS 模板新增 Tailwind class，需要重新生成：

```bash
npx --yes tailwindcss@3.4.17 \
  -i ./tools/tailwind-input.css \
  -o ./tailwind.min.css \
  --content './index.html' './src/**/*.js' \
  --minify
```

### Chrome 启动器

默认 `启动翻译工具.bat` 必须保持 Web Security，不得重新加入：

```text
--disable-web-security
```

确有 CORS 兼容需求时只使用：

```text
启动翻译工具(兼容模式).bat
```

兼容模式必须继续使用独立 Chrome Profile。

### API Key

API Key 当前保存在 localStorage，并可能在配置导出 JSON 中明文出现。因此不要引入任何不必要的运行时第三方脚本。

## Provider Adapter 约定

所有 `/chat/completions` 请求体必须经过：

```js
ProviderAdapters.buildChatRequest(profile, options)
```

不要在 `app.js` 或 `client.js` 其它位置重新手写一套模型参数分支。

Adapter 当前处理：

```text
openai
openrouter
gemini
deepseek
qwen
generic
```

模型参数兼容规则集中在：

```text
src/api/provider-adapters.js
```

例如部分 reasoning / 新模型使用：

```text
max_completion_tokens
```

而常规模型使用：

```text
max_tokens
```

部分模型不发送 `temperature`。

未来增加模型兼容逻辑时，只扩展 adapter，不要污染主请求流程。

## 请求层约定

网络相关代码放在：

```text
src/api/client.js
```

### 空闲超时

超时按“多久没收到数据”计算，不是请求总时长。

`gate.bump()` 在以下情况重置计时器：

- 收到响应头
- 收到 SSE 数据块

不要改成固定总时长超时，否则会误杀正常长流式请求。

### cleanup

`gate.cleanup()` 必须保留在 `finally`。

否则会泄漏：

- timeout timer
- external abort listener

### 自动重试

统一由 `shouldRetry()` 控制。

允许：

```text
429
5xx
network error
```

禁止：

```text
普通 4xx
用户取消
空闲超时
已经收到部分输出后的中断
```

原因：流已经输出内容后整体重试会导致重复结果。

### Retry-After

服务端返回 `Retry-After` 时优先遵守，否则使用指数退避 + 抖动。

## SSE 约定

当前解析逻辑支持完整 event 分隔，而不是逐行假设。

必须继续兼容：

- LF / CRLF
- 多行 `data:`
- `[DONE]`
- EOF 前最后一个 event 没有空行
- `choices[0].delta.content`
- `choices[0].text`

不要退回早期的简单 `buffer.split('\n')` 实现。

## 翻译主流程

一次翻译拆成：

```text
A = en + zh
B = es + pt
```

使用 `Promise.allSettled` 并发执行。

不要合回单请求。输出 token 是主要延迟来源，双路并发是刻意的性能设计。

### 部分成功规则

如果一路成功、一路失败：

- 保留已经生成的结果。
- 显示错误提示。
- 不进入压缩流程。
- 不写历史。
- 不显示完整“完成”状态。

`renderOutput` 必须跳过尚未生成的语言，不能用 `(无)` 伪造结果。

`saveHistory` 自身也必须保留四语完整性检查，作为第二道防线。

## 输出 JSON

主 Prompt 输出：

```json
{
  "en": { "title": "..." },
  "es": { "title": "...", "analysis": "..." },
  "pt": { "title": "...", "analysis": "..." },
  "zh": { "title": "..." }
}
```

`analysis` 仅用于 es / pt。

实际请求时 `buildRoutePrompt()` 会限制每一路只返回自己的语种字段，之后主流程再合并。

## 字符计数

代码位于：

```text
src/translation.js
```

规则：

```text
EN / ES / PT: String.length
CN: 汉字/中文标点/全角字符 = 2，其它 = 1
```

不要让模型自己逐字符计数。字符校验由程序完成。

## Prompt 约定

全局 Prompt 定义位于：

```text
src/core/config.js
```

不要重新加入“逐字符数一遍”“字符计数示范”一类指令，这会显著拖慢思考型模型。

Prompt 注释行：

```text
//
#!
#！
```

发送给 AI 前由 `stripPromptComments()` 去除。

## 压缩复检

重要约束：

- 最多 `MAX_SHORTEN_ROUNDS = 2`。
- 必须保留核心类目、材质和功能词。
- 禁止通过“暗示”替代被删除核心词。
- 禁止截断单词。
- 优先删无意义修饰、数量尾缀、重复表达。

压缩失败时保留原结果，并明确提示。

不要把“压缩失败”当成成功。

## Profile / localStorage

主要数据 Key：

```text
translator_profiles_v1
translator_global_prompt_v1
translator_history_v1
translator_calc_params_v1
translator_fast_mode
translator_calc_floating_state
```

这些 Key 属于持久化兼容接口。

**禁止无迁移直接改名。**

Profile schema 新增字段时：

1. 更新 `normalizeProfile()` 默认值。
2. 必要时提高 schemaVersion。
3. 在 `loadProfilesStore()` 增加向后兼容迁移。
4. 保证旧用户数据可正常读取。

## 配置导入导出

导出的 API Key 是明文。

导入时继续使用字段白名单过滤，避免：

```text
__proto__
constructor
未知字段
```

污染本地配置对象。

不要直接 `Object.assign` 任意外部 JSON 到内部 Profile。

## UI / app.js 边界

以下逻辑适合留在 `src/app.js`：

- DOM 查询和写入
- event listener
- Toast
- Profile 表单交互
- History drawer
- 翻译主流程 orchestration
- 压缩确认 UI
- 利润计算器 UI

如果代码只是“页面怎么交互”，不要为了架构纯洁拆到更多文件。

## 修改位置速查

| 要修改什么 | 文件 |
| --- | --- |
| 默认 Prompt / Profile schema | `src/core/config.js` |
| 新模型参数兼容 | `src/api/provider-adapters.js` |
| HTTP / SSE / retry / timeout | `src/api/client.js` |
| 字符计算 / Prompt 领域逻辑 | `src/translation.js` |
| 页面 UI / 按钮 / 主流程 | `src/app.js` |
| 页面结构 | `index.html` |
| Tailwind 构建输入 | `tools/tailwind-input.css` |

## CI 与验证

至少保证以下文件通过：

```bash
node --check src/core/config.js
node --check src/api/provider-adapters.js
node --check src/api/client.js
node --check src/translation.js
node --check src/app.js
```

然后执行：

```bash
python tools/validate_app.py
```

CI 还会检查关键不变量，例如：

- runtime Tailwind CDN 未重新出现
- 默认启动器没有关闭 Web Security
- 兼容模式仍明确存在
- SSE parser 没有退化
- partial-result guard 存在
- incomplete history guard 存在
- 脚本加载顺序正确

不要绕过这些检查来“让 CI 变绿”。如果检查失败，应修正代码或更新已经明确改变的架构契约。

## 文档同步

架构变化后至少同步：

```text
README.md
AGENTS.md
docs/ARCHITECTURE.md
```

README 面向用户和普通开发者；AGENTS 面向 AI / 维护者；ARCHITECTURE 记录长期设计边界。

## 不建议做的事情

- 不要引入 React / Vue / Electron，除非项目定位发生明确变化。
- 不要为了模块化拆出十几个只有几十行的小文件。
- 不要重新引入 Tailwind CDN。
- 不要在默认启动器关闭 Web Security。
- 不要把网络层写回 `app.js`。
- 不要把 provider 特判散落到各函数。
- 不要让 partial result 写入历史。
- 不要更改 localStorage Key 而不给迁移。
- 不要把两路并发翻译合并回单请求。

详细架构说明见 `docs/ARCHITECTURE.md`。