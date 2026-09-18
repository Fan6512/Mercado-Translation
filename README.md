# 跨境电商多语种标题翻译工具

AI 驱动的跨境电商商品标题翻译工具。输入中文或英文标题，可同时生成英语、西班牙语、葡萄牙语和中文电商标题，并提供字符限制控制、SEO 关键词优化、Google Translate 预检、自动压缩复检、历史记录和跨境利润计算器。

项目采用轻量化前端架构：无需 Node 运行时、无需 Web 服务器、无需打包器即可使用；HTML、CSS 与 JavaScript 已按职责拆分，仍保持 Windows 本地直接运行和 Pake 桌面打包能力。

## 文档

- `README.md`：使用方法、配置方式、功能说明、项目结构和基础开发约定。
- `AGENTS.md`：给 AI 助手和维护者的代码修改规则、关键不变量和文件归属约定。
- `docs/ARCHITECTURE.md`：长期架构边界、模块职责、数据流、请求模型和演进原则。

## 功能特性

- **四语输出**：English / Español（拉美） / Português（巴西） / 中文。
- **字符限制**：默认 EN/ES/PT 上限 55，CN 上限 60；中文按汉字 2 字符计数。
- **SEO 标题优化**：西语与葡语输出关键词和流量解析说明。
- **双路并发生成**：EN+ZH 与 ES+PT 两路并发，减少整体等待时间。
- **自动压缩复检**：超限后可调用 AI 重写，最多 2 轮，并保留核心信息词。
- **部分结果保护**：任一路失败时保留已生成结果，但不写历史、不进入压缩、不伪装成完整成功。
- **多 API 配置**：支持 OpenAI、Gemini、DeepSeek、通义千问、OpenRouter、移动云 MiniMax 及通用 OpenAI-compatible 接口。
- **Provider Adapter**：自动兼容 `max_tokens` / `max_completion_tokens` 等模型参数差异。
- **流式响应**：支持 SSE、空闲超时、取消、429/5xx 自动重试和指数退避。
- **Google Translate 预检**：AI 调用前核对原标题语义。
- **配置导入导出**：多套 API 配置可整体备份与迁移。
- **历史记录**：仅完整四语结果写入本地历史。
- **利润计算器**：输入采购价实时计算 USD 净收益价和 CNY 真实利润。
- **Windows 桌面版**：可使用 Pake 打包为 `.msi` / `.exe`。

## 快速开始

### 方式一：安全浏览器模式

1. 下载或克隆仓库。
2. 双击 `启动翻译工具.bat`。
3. 在右上角「设置」中填写 API Base、API Key 和模型名。
4. 保存配置后即可使用。

默认启动器**不会关闭 Chrome Web Security**。因此目标 API 或中转服务需要允许浏览器 CORS。

如果 API 不支持 CORS，优先建议使用桌面版，或者配置支持 CORS 的 HTTP 中转。

### 方式二：兼容模式

仓库保留：

```text
启动翻译工具(兼容模式).bat
```

兼容模式会使用独立 Chrome Profile，并通过 `--disable-web-security` 放宽浏览器同源限制，仅用于兼容不支持 CORS 的接口。

> 兼容模式存在更高安全风险。不要在该 Chrome 实例中浏览其它网站，也不要把它作为日常浏览器使用。

### 方式三：桌面版

桌面版推荐用于团队内部长期使用。

前置依赖：

1. Node.js LTS
2. Rust 工具链
3. Visual Studio Build Tools 2022
4. Windows SDK

打包步骤：

```text
1. 双击 生成图标.html 生成 icon.ico
2. 双击 一键打包桌面版.bat
3. 构建产物自动复制到 dist/
```

清理构建缓存可执行：

```text
clean.bat
```


## 自动正式发布（Windows）


从 **v1.2.0** 起，Windows Release 固定提供两种产物：

- `Mercado-Translation-vX.Y.Z-Windows-x64-Setup.msi`：**推荐安装 / 覆盖升级版**。同一 MSI UpgradeCode 跨版本保持不变，Windows 会把新版识别为同一个应用的升级。
- `Mercado-Translation-vX.Y.Z-Windows-x64-Portable.exe`：**免安装便携版**。适合临时运行，不作为自动升级入口。

Windows 安装版启动后会自动检查 GitHub 最新正式 Release。若发现更高版本，会弹出“发现新版本”提示；点击“立即升级”后，应用会下载本仓库 Release 中对应的 `Setup.msi`，以 Windows 被动安装模式启动覆盖升级并退出当前程序。

自动更新的原生桥接只允许访问：

```text
https://github.com/Fan6512/Mercado-Translation/releases/download/...
```

且只接受符合固定命名规则的 `Mercado-Translation-vX.Y.Z-Windows-x64-Setup.msi`，不会执行任意 URL 或任意 MSI。

安装身份显式锁定为当前 Tauri/Pake 历史默认身份：

```text
WiX UpgradeCode: 18f5c230-146b-5d19-988a-6204008097ea
App Identifier:   com.pake.translator
Product Name:     Translator
```

这样可保持与 v1.0.0 / v1.1.0 的既有安装身份连续，避免升级后出现两个独立安装项。


仓库使用 GitHub Actions 自动构建 Windows x64 桌面版。

正式版本采用语义化 Tag：

```text
v1.0.0
v1.1.0
v2.0.0
```

除了本地推送 Tag，也可以完全在 GitHub 网页手动发布：

```text
Actions
→ Release Windows desktop
→ Run workflow
→ 输入版本号，例如 v1.2.0
→ Run workflow
```

手动模式会固定从最新 `main` 构建；构建、签名、校验全部成功后，workflow 会自动创建对应 Tag 和正式 GitHub Release。无需本地 Git。

只要 Tag 指向 `main` 中的提交，或者使用 GitHub 手动发布入口输入合法的 `vX.Y.Z` 版本号，就会自动执行：

```text
验证应用
→ Windows x64 Pake 构建
→ 生成安装包 + 独立 EXE
→ 自签名
→ 生成 SHA-256 校验文件
→ 创建正式 GitHub Release
→ 上传全部发布文件
```

发布示例：

```bash
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

Release workflow 固定使用经过验证的 Pake 版本，并把 Tag 中的版本号传给 `--app-version`。普通 push 到 `main` 不会创建 Release。

### 一次性配置自签名证书

为了让每次 Release 使用同一个发布者身份，不会在 CI 中临时生成随机证书。先在自己的 Windows 电脑运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\New-SelfSignedCodeSigningCert.ps1
```

脚本会生成：

```text
Mercado-Translation-CodeSigning.pfx
Mercado-Translation-CodeSigning.cer
Mercado-Translation-CodeSigning.base64.txt
```

其中：

- `.pfx` 包含私钥，只能自己保存。
- `.base64.txt` 是给 GitHub Secret 使用的私钥编码，同样不能公开。
- `.cer` 只包含公钥证书，可以公开。
- 上述本地证书文件已经加入 `.gitignore`，禁止提交到仓库。

然后在 GitHub 仓库：

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

添加：

| Secret | 内容 |
| --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | `Mercado-Translation-CodeSigning.base64.txt` 的完整内容 |
| `WINDOWS_CERT_PASSWORD` | 创建 PFX 时输入的密码 |

之后所有正式 Release 都会复用这张证书，并使用 SHA-256 Authenticode 签名和 RFC3161 时间戳。

> 这是自签名证书，不是公开 CA 信任的代码签名证书。EXE 虽然具有一致的数字签名，但未安装该证书的 Windows 设备仍可能显示 SmartScreen / 未知发布者警告。Release 会同时附带公开的 `.cer` 文件，供需要的设备手动建立信任。

发布产物包括：

```text
Mercado-Translation-vX.Y.Z-Windows-x64-Portable.exe
Mercado-Translation-vX.Y.Z-Windows-x64-Setup.msi
Mercado-Translation-SelfSigned-Publisher.cer
SHA256SUMS.txt
```

## API 配置

支持任意兼容 OpenAI Chat Completions 风格的服务。

| 服务 | API Base |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| 移动云 MaaS | `https://zhenze-huhehaote.cmecloud.cn/v1` |

每套 Profile 独立保存：

```text
name
base
key
model
temperature
maxTokens
stream
charLimit
charLimitCN
timeout
retry
proxy
```

### Provider Adapter

请求体不会再直接散落在页面逻辑中，而是统一通过：

```text
src/api/provider-adapters.js
```

处理模型差异。

目前会自动区分：

```text
OpenAI
OpenRouter
Gemini OpenAI-compatible
DeepSeek
Qwen
generic OpenAI-compatible
```

对于部分 reasoning / 新一代模型，例如 `o1/o3/o4`、`gpt-5*`、`gpt-6*`，Adapter 会优先使用：

```json
{
  "max_completion_tokens": 4000
}
```

常规模型继续使用：

```json
{
  "max_tokens": 4000,
  "temperature": 0.7
}
```

这样模型兼容逻辑不会污染主翻译流程。

## 请求稳定性

### 空闲超时

默认 120 秒。

超时计算的是：

> 多久没有收到任何新数据

而不是整个请求总时长。每收到响应头或 SSE 数据块都会重新计时，因此正常的长流式请求不会被误杀。

### 自动重试

仅重试：

- HTTP 429
- HTTP 5xx
- 网络中断

采用指数退避：

```text
1s → 2s → 4s → ...
```

最多约 8 秒基础等待，并带随机抖动；如果响应包含 `Retry-After`，优先遵守服务端要求。

以下情况不会自动重试：

- 普通 4xx
- 用户主动取消
- 空闲超时
- 已经收到部分模型输出后的连接中断

### SSE

流式解析支持：

- CRLF / LF
- 多行 `data:`
- `[DONE]`
- 末尾没有额外空行的 event
- `choices[0].delta.content`
- 部分兼容接口的 `choices[0].text`

## 翻译流程

主翻译会拆成两路：

```text
Route A: EN + ZH
Route B: ES + PT
```

两路使用 `Promise.allSettled` 并发执行。

结果规则：

```text
4/4 成功
→ 渲染
→ 字符校验
→ 可选压缩
→ 写历史

部分成功
→ 保留成功结果
→ 提示错误
→ 不压缩
→ 不写历史

全部失败
→ 显示错误
```

## 字符规则

英语 / 西班牙语 / 葡萄牙语：

```text
String.length
```

包含空格和标点。

中文：

```text
汉字 / 中文标点 / 全角字符 = 2
其它字符 = 1
```

默认：

```text
EN / ES / PT = 55
CN = 60
```

## 压缩复检

非快速模式下，超限语种会进入确认流程。

压缩规则包括：

- 必须保留核心类目词、材质词和功能词。
- 禁止用隐含表达代替被删除的核心信息。
- 禁止截断单词。
- 优先删除无意义形容词、冗余数量单位和重复表达。
- 最多压缩 2 轮。

## 配置导入 / 导出

配置文件包含：

- Profile 列表
- 当前 Profile
- 字符限制
- 请求参数
- 代理配置
- 压缩范围
- 用户自定义全局 Prompt（如果存在）

> 导出的 JSON 中 API Key 为明文，请自行妥善保存。

翻译历史不会包含在配置备份中。

## 本地数据

主要 localStorage Key：

| Key | 用途 |
| --- | --- |
| `translator_profiles_v1` | API Profiles + schema + 压缩范围 |
| `translator_global_prompt_v1` | 全局 Prompt |
| `translator_history_v1` | 翻译历史 |
| `translator_calc_params_v1` | 利润计算器参数 |
| `translator_fast_mode` | 快速模式 |
| `translator_calc_floating_state` | 计算器折叠状态 |

修改这些 Key 时必须提供迁移逻辑，否则会造成老用户数据丢失。

## 项目结构

```text
.
├── index.html
├── tailwind.min.css
│
├── src/
│   ├── core/
│   │   └── config.js
│   │
│   ├── api/
│   │   ├── provider-adapters.js
│   │   └── client.js
│   │
│   ├── translation.js
│   └── app.js
│
├── tools/
│   ├── tailwind-input.css
│   ├── validate_app.py
│   ├── New-SelfSignedCodeSigningCert.ps1
│   └── Patch-PakeWindowsUpdater.ps1
│
├── docs/
│   └── ARCHITECTURE.md
│
├── .github/workflows/
│   ├── verify.yml
│   └── release-windows.yml
│
├── 启动翻译工具.bat
├── 启动翻译工具(兼容模式).bat
├── 启动翻译工具(静默).vbs
├── 一键打包桌面版.bat
├── clean.bat
├── 生成图标.html
├── icon.svg
├── AGENTS.md
└── README.md
```

### 模块职责

| 文件 | 职责 |
| --- | --- |
| `index.html` | HTML/UI 骨架和脚本加载顺序 |
| `src/core/config.js` | 默认 Prompt、Profile 数据模型、schema、配置存储和迁移 |
| `src/api/provider-adapters.js` | Provider / model 参数兼容 |
| `src/api/client.js` | HTTP、代理、超时、重试、取消、SSE、`callAI` |
| `src/translation.js` | 字符计数、Prompt 预处理、多语路由等翻译领域逻辑 |
| `src/app.js` | UI、事件、翻译主流程、历史、压缩交互和页面编排 |

没有继续把 Toast、History、Calculator 等拆成独立文件，这是刻意保持的中等粒度架构，避免过度模块化。

## Tailwind CSS

运行时不再加载 `cdn.tailwindcss.com`。

仓库使用本地：

```text
tailwind.min.css
```

重新生成命令：

```bash
npx --yes tailwindcss@3.4.17 \
  -i ./tools/tailwind-input.css \
  -o ./tailwind.min.css \
  --content './index.html' './src/**/*.js' \
  --minify
```

如果 JS 模板中增加新的 Tailwind class，需要重新生成 CSS。

## 验证

仓库带 GitHub Actions 静态验证。

主要检查：

- 所有 JS 文件 `node --check`
- 本地 Tailwind CSS 存在
- 运行时没有 Tailwind CDN
- 默认启动器没有 `--disable-web-security`
- 兼容模式明确保留该参数
- SSE parser 仍存在
- partial-result guard 仍存在
- history 不写入不完整结果
- 模块加载顺序正确

开发后建议至少执行：

```bash
node --check src/core/config.js
node --check src/api/provider-adapters.js
node --check src/api/client.js
node --check src/translation.js
node --check src/app.js
python tools/validate_app.py
```

## 开发原则

1. 保持浏览器直接运行能力，不依赖开发服务器。
2. 不随意引入 bundler / framework。
3. 网络行为统一放在 `src/api/client.js`。
4. 模型参数差异统一放在 `provider-adapters.js`。
5. 翻译纯逻辑优先放 `translation.js`。
6. UI 和页面编排留在 `app.js`。
7. localStorage Key 不可无迁移直接修改。
8. 不把双路并发重新合回单请求。
9. 不允许 partial result 被当作完整结果写入历史。
10. 不重新引入运行时第三方 CDN 脚本。

## License

MIT License。