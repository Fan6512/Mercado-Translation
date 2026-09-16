# AGENTS.md

给未来在这个仓库工作的 AI 助手（Claude、Cursor、Copilot 等）的快速上手指南。

## 项目本质

**单文件 HTML 应用，没有任何构建步骤。** 所有代码（HTML + CSS + JS）都在 `index.html` 一个文件里，约 1100 行。修改后保存即可生效，不要试图引入 webpack/vite/任何 bundler。

CSS 走 Tailwind CDN（`https://cdn.tailwindcss.com`），不要替换成本地构建版。

## 核心域名词

| 名词 | 含义 |
| --- | --- |
| **Profile** | 一套 API 配置（base / key / model / temp / maxTokens），用户可保存任意多套并一键切换 |
| **代理** | 配置级代理。`mode=system`：本机/系统代理，网页版靠启动器 `--proxy-server`、客户端版靠系统代理或 Pake `--proxy-url`；`mode=prefix`：HTTP 中转，请求地址前面拼上代理地址。注意正向代理（Clash 7890）只能走 system 模式 |
| **空闲超时** | 按「多久没收到数据」计时，每收到一段流式内容就重置（`gate.bump()`）。所以流式长任务不会被误杀，只有真卡死才中止。配置项为 `profile.timeout` 秒，0 = 不限 |
| **失败重试** | 仅对 429 / 5xx / 网络中断重试，指数退避 1s→2s→4s（上限 8s）+ 抖动，优先遵守 `Retry-After`。4xx、用户取消、空闲超时、以及「已经收到部分内容」的中断都不重试 |
| **运行取消** | 一次生成 = 一个 `activeRun`（含一个 `AbortController`）。两路并发与压缩请求共用它的 signal；取消后保留已渲染的部分结果、不写历史 |
| **全局 Prompt** | 跨 profile 共享的主提示词，定义了翻译任务、4 个语种、JSON 输出 schema、字符限制规则 |
| **会话 Prompt** | 单次翻译的额外提示词，附加在全局 Prompt 之后 |
| **流量解析** | 西语/葡语输出中包含的关键词解析说明（为什么选这个词、搜索量大约多少），英语/中文不输出此字段 |
| **压缩复检** | 超字符限制后调用 AI 重新压缩的二次请求，最多 2 轮 |
| **压缩范围** | 用户可选择哪些语种参与压缩（en/es/pt/zh 各自独立开关） |
| **快速模式** | 跳过压缩复检的开关，trade off 精度换速度 |
| **预检翻译** | 调 Google 免费翻译接口先核对原标题，可一键替换 |
| **利润计算器** | 右侧 sticky 侧栏，输入采购价实时算 USD 净收益价 + CNY 真实利润 |

## 关键函数索引

按文件内出现顺序，所有定义都在 `<script>` 块内（从 line 207 开始）：

| 函数 | 作用 |
| --- | --- |
| `loadProfilesStore` / `saveProfilesStore` | 读写 profile 数据（localStorage） |
| `getActiveProfile` | 获取当前选中的 profile 对象 |
| `switchProfile`, `newProfile`, `renameProfile`, `duplicateProfile`, `deleteProfile` | profile CRUD，每个都带 try/catch 和 toast 提示 |
| `loadProfileToForm` / `renderProfileSelect` | 把 profile 数据填充到 UI 表单 / 下拉菜单 |
| `saveSettings` | 保存当前 profile（点击"保存当前配置"按钮时触发） |
| `loadGlobalPrompt` / `saveGlobalPrompt` / `resetGlobalPrompt` | 全局 Prompt 读写 + 恢复默认 |
| `updateProxyUI` / `downloadProxyTxt` | 代理区块显隐与模式提示 / 导出 `proxy.txt`（供网页版启动器读取） |
| `fetchJsonWithRetry` | 单次 GET/POST（带空闲超时 + 429/5xx 重试）；`fetchModels` / `testConnection` 都走它，失败抛出的 error 带 `status` |
| `pickProfileFields` / `downloadTextFile` | 导入导出共用的字段白名单过滤 / 通用文本下载（`proxy.txt` 也复用） |
| `stripPromptComments` | 调 AI 前剥离 `//`、`#!`、`#！` 开头的行 |
| `buildApiUrl` / `applyProxyPrefix` | 拼出最终请求地址；`prefix` 模式把原始地址接到代理地址之后（Google 预检也走这个函数） |
| `makeRequestGate` / `normalizeFetchError` / `shouldRetry` / `backoffDelayMs` / `sleep` | 请求层五个原语：空闲超时闸门（收数据即重置 + 合并外部取消信号）/ 原始错误中文化并标注 取消·超时·网络错误 / 判定是否值得重试 / 指数退避+抖动（遵守 `Retry-After`）/ 可被取消打断的等待 |
| `callAI` | OpenAI 兼容协议调用，核心网络层。第 4 参 `opts` 可传 `{temperature, maxTokens, messages, stream, signal, timeout, retry, onRetry}`；支持 SSE 流式与非流式两条分支；**外层是重试循环，内层 `requestOnce()` 是单次请求**，压缩请求也复用它 |
| `beginRun` / `endRun` / `isRunCancelled` / `cancelRun` | 单次生成的运行态与取消（同一个 `AbortController` 覆盖两路并发 + 压缩请求） |
| `stripCodeFence` | 剥离模型返回的 \`\`\`json ... \`\`\` 包裹 |
| `googleTranslate` | 调 translate.googleapis.com 的非官方 endpoint |
| `countChars` / `listOverLimit` | 字符计数（中文 1 字符算 2），找出超限的语种 |
| `shortenOverLimit` / `askUserShorten` | 自动压缩复检 + 用户确认对话框 |
| `flash` / `showError` / `showToast` | Toast 提示系统（右上角浮窗） |
| `recalcProfit` / `saveCalcParams` / `loadCalcParams` | 利润计算器 |
| `saveHistory` | 翻译完成后写入历史 |

## localStorage Key 约定

⚠️ **改动这些 Key 名等于让所有老用户丢数据**，除非有迁移逻辑，不要改。

```js
const STORE = {
  profiles:     'translator_profiles_v1',       // 所有 API 配置 + 字符上限 + shortenScope
  globalPrompt: 'translator_global_prompt_v1',
  history:      'translator_history_v1',
};
const CALC_STORE = 'translator_calc_params_v1';
const FLOAT_CALC_STATE = 'translator_calc_floating_state';
const FAST_MODE = 'translator_fast_mode';
```

## 输出 JSON Schema

AI 必须返回如下结构（schema 在 `DEFAULT_GLOBAL_PROMPT` 中规定）：

```json
{
  "en":  { "title": "...", "keywords": "..." },
  "es":  { "title": "...", "keywords": "...", "analysis": "..." },
  "pt":  { "title": "...", "keywords": "...", "analysis": "..." },
  "zh":  { "title": "...", "keywords": "..." }
}
```

`analysis` 字段只对 es/pt 输出（流量解析）。en/zh 不需要。

## 字符计数规则

- 英语 / 西语 / 葡语：原始 `String.length`，包含空格和标点
- 中文：每个汉字记 2，其他字符记 1（中文电商平台惯例）

代码在 `countChars(text, isCN)`。判断中文用正则 `/[一-鿿　-〿＀-￯]/`。

## 压缩复检流程（重要）

1. 首次 AI 返回 → 检测每个语种字符是否超限
2. 找到超限的语种 + 用户 shortenScope 允许的语种 → 调 `askUserShorten` 弹确认框
3. 用户同意 → 把超限的 title 列表作为 input 再调一次 AI（用专门的压缩 Prompt）
4. 压缩 Prompt **明确禁止**：暗示核心词、用同义词替换、截断单词。允许：删形容词、删冗余修饰、合并同义短语
5. 最多 2 轮（`MAX_RETRY = 2`），仍超限就停下让用户手动调整

如果改动压缩逻辑，务必保留"禁止暗示/截断"的硬性约束，否则会破坏标题语义（这是用户明确反复强调过的）。

## 请求层约定（超时 / 重试 / 取消）
`callAI` 的结构是「外层重试循环 + 内层 `requestOnce()` 单次请求」，改网络行为时注意保持这个分层：
1. **超时用空闲口径，不要改成总时长**。`makeRequestGate` 的计时器在每次 `gate.bump()`（收到响应头、收到每个流式分片）时重置。改成固定总时长会误杀正常的流式长任务。
3. **可重试的判定集中在 `shouldRetry()`**，不要在别处再写一套。当前口径：429 / 5xx / 网络中断可重试；4xx、用户取消（`cancelled`）、空闲超时（`timeout`）都不可重试。
4. **只有「一个字都没收到」时才允许重试**。流已经开始吐内容后再整体重试会造成重复输出，`requestOnce()` 里对此显式判断并抛「连接中断（已收到部分内容，未重试）」。
5. **区分「取消」和「超时」靠 `gate.reason()`，不要靠错误类型**。Chrome 在不同路径下可能抛 `AbortError` 或我们传入的 abort reason，只有闸门自己知道是哪种。
6. `fetchJsonWithRetry` 是给非流式小请求（`/models`、测试连接）用的，失败抛出的 error 带 `status` 字段；测试连接故意传 `retry: 0`，因为重试会让显示的延迟失真。
7. 任何新的 `fetch` 都应该经过 `makeRequestGate`（现有的三处：`callAI`、`fetchJsonWithRetry`、`googleTranslate`），否则它既不会超时也不会被取消。
## 代理配置（双端）
网页版与客户端版走代理的方式不同，但配置项是同一套（`profile.proxy`）：
| 客户端版（Pake） | 默认回退**系统代理**（Clash 开系统代理 / TUN 即可）。要固定代理：把地址写进 `proxy.txt`，打包脚本会自动传给 `--proxy-url`（HTTP / HTTPS / SOCKS5 均可，macOS 需 14+） |
| 网页版（Chrome 启动器） | 把地址写进工具目录的 `proxy.txt`（首行），`启动翻译工具.bat` 会自动加 `--proxy-server`。App 里「使用代理 → 本机/系统代理」下有「下载 proxy.txt」按钮 |
| 有中转服务 | 配置里选 `HTTP 中转（请求前缀）`，请求会发往 `代理地址 + 接口地址`。适用于 one-api 网关 / cors 代理；本机 Clash 这类正向代理**不适用** |
⚠️ 浏览器页面无法给单个 `fetch` 指定代理，所以正向代理只能在 `system` 模式下生效（由启动器或系统层接管）。`proxy.txt` 已在 `.gitignore` 里，不会被提交。
## 桌面版打包（Pake）

打包脚本 `一键打包桌面版.bat` 的关键设计：

1. 用 `vswhere.exe` 自动定位 VS Build Tools 安装位置
2. 通过 `cmd /c "vcvars64.bat && npx pake-cli ..."` 把环境加载和打包都塞进子进程，避免污染外层 bat（直接在外层 bat 里 `call vcvars64.bat` 会导致 bat 重启循环，已踩过坑）
3. 所有输出写入 `build-log.txt`，便于事后排查
4. 结束后自动扫描所有 npx 缓存目录，输出 .msi / .exe 路径

⚠️ Pake 硬编码 `--target x86_64-pc-windows-msvc`，不能用 GNU 工具链替代，必须装 MSVC。

## UI 布局约定

外层是 `max-w-[1400px] mx-auto flex` 两栏布局：

```
┌─────────────────────────────┬──────────┐
│ flex-1 (主内容)             │ aside    │
│  - API 设置                 │ (sticky) │
│  - 全局 Prompt              │ - 利润   │
│  - Google 预检              │   计算器 │
│  - 原始标题输入             │          │
│  - 会话 Prompt              │          │
│  - 翻译结果（4 个卡片）     │          │
└─────────────────────────────┴──────────┘
```

侧栏在 `lg` 断点（≥1024px）以下隐藏。计算器最小化时显示一个"展开"长条按钮。

整体页面用 `lg:pl-[8%] xl:pl-[10%]` 把内容往右偏一点，避免在宽屏上视觉重心偏左。

## Toast 系统

`showToast(msg, type, duration)` — type 取 `success` / `error` / `info`，默认 2200ms 自动消失。多个 toast 垂直堆叠在右上角。

`flash()` 和 `showError()` 是兼容旧代码的薄包装，分别等价于 success 和 error toast。

新增保存操作时，记得：

```js
try {
  localStorage.setItem(...);
  flash('已保存：XXX');
} catch (err) {
  showError('保存失败：' + (err.message || err));
}
```

## 不要做的事

1. **不要** 把 `index.html` 拆成多个文件 — 单文件是产品特性
2. **不要** 引入构建工具（webpack/vite/rollup） — 用户期望"开箱即用"
3. **不要** 改动 localStorage Key 名称 — 会让用户数据丢失
4. **不要** 移除压缩 Prompt 里"禁止暗示/截断核心词"的约束
5. **不要** 把 `flash()` 改回原先的 `errorHint` 文本提示（已升级成 toast）
6. **不要** 提交 `.chrome-profile/`、`build-log.txt`、`*.msi`、`icon.ico`、`icon.png` — 这些都在 `.gitignore` 里
7. **不要** 用 `alert()` / `confirm()` 替代 toast 来反馈普通操作结果（用户体验差异大）
9. **不要** 移除 `proxy.txt` 约定 —— 网页版启动器与桌面打包脚本都靠它读取本机代理地址
12. **不要** 把 `makeRequestGate` 的空闲超时改成总时长超时，也**不要**在用户取消/超时后仍然重试
13. **不要** 移除「已收到部分内容则不重试」的判断 —— 否则流中断重试会让标题内容重复拼接

## 测试方式

没有自动化测试。手动验证清单：

1. 启动 `启动翻译工具.bat`，确认 4 个语种都能输出 JSON
2. 故意把字符上限设小（如 30），确认触发压缩复检并弹确认框
3. 保存 / 切换 / 新建 / 删除 profile 都能弹 toast
4. 利润计算器输入采购价能实时显示 USD 价 + CNY 利润
5. Google 预检翻译能调通并能"应用到原始标题"
6. 历史记录能正常写入并复用
10. 生成中点「✕ 取消」：立即停止、保留已出卡片、不写历史；点取消后不再有网络请求
11. 把「请求超时」设成 5 秒 + 用一个超长输出的模型，确认流式过程中不会误报超时（每收到数据会重置计时）
12. 用一个会返回 429/503 的接口（或临时改错 base），确认界面出现「重试 1/2 · 服务端错误 5xx」并在退避后恢复；4xx 则应立即报错不重试

## 常见踩坑

- **Failed to fetch**：CORS 被浏览器拦了，必须用 `启动翻译工具.bat`（带 `--disable-web-security`）或桌面版
- **AI 返回非 JSON**：通常是 \`\`\`json 包裹或 maxTokens 不够。前者已用 `stripCodeFence` 处理，后者需用户调高 maxTokens
- **VBS 启动失败**：VBS 源文件含中文注释会导致 ANSI 解析器崩溃，必须保持纯 ASCII
- **桌面版打包 `link.exe not found`**：MSVC Build Tools / Windows SDK 没装好，或装好后没重启
- **桌面版打包 bat 日志反复重启**：不要在 bat 顶层直接 `call vcvars64.bat`，要用 `cmd /c "...vcvars64.bat && ..."` 包裹
- **网页版代理不生效**：确认 `proxy.txt` 就在工具目录、首行是完整地址（含 `http://` 前缀），改完必须重启启动器
- **代理填了但请求仍超时**：若选的是「HTTP 中转」，本机 Clash 这类正向代理不适用，请改选「本机 / 系统代理」
- **一直转圈没有输出**：个别中转网关不支持 SSE，关掉配置里的「使用流式输出」；也可以点「✕ 取消」直接停
- **频繁报「请求超过 N 秒没有收到数据」**：说明网关长时间不吐数据（或代理在掉包）。调大配置里的「请求超时」，或换直连更稳的端点；注意这是**空闲**超时，正常的慢速流式不会被它误杀
- **脚本里改测试时注意**：从 `index.html` 里正则抽函数做单测时，按「行首单列 `}`」切分比花括号配对可靠——参数里的解构 `= {}` 会让配对提前结束

## 提交规范

中文 commit message 即可，简洁说明改了什么。建议格式：

```
feat: 加 XX 功能
fix: 修 XX 问题
refactor: 重构 XX
style: 调整 UI
docs: 改文档
```

没有 CI，直接推 main 即可。
