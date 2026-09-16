# 跨境电商多语种标题翻译工具

> 单文件 HTML 应用，团队内部使用。AI 驱动的跨境电商商品标题"中/英 → 英/西/葡/繁中"四语翻译，自带字符限制控制、SEO 关键词优化、Google Translate 预检、跨境利润计算器，可一键打包成 Windows 桌面应用。

## ✨ 功能特性

- **四语同时输出**：English（全球/北美） / Español（中性拉美西语） / Português（巴西本土） / 繁体中文（淘宝/拼多多/Shopee TW 风格）
- **严格字符限制**：默认 EN/ES/PT 上限 55，CN 上限 60（汉字按 2 计算），可自定义
- **SEO 关键词优化**：每个语种生成高搜索量关键词，并提供流量解析说明（西语/葡语）
- **自动压缩复检**：超限标题自动调用 AI 重新压缩，禁止暗示/截断/同义替换核心词
- **多 API 配置**：内置 7 个预设（OpenAI / Gemini / DeepSeek / 通义千问 / OpenRouter / 移动云 MiniMax / 空白），可保存任意多套配置一键切换
- **Google Translate 预检**：在调用 AI 前可先用 Google 翻译核对原文语义，并一键替换原标题
- **跨境利润计算器**：浮动侧栏，输入采购价实时计算 USD 净收益价 + 真实利润，固定参数（利润率、汇率、其他费用）持久化
- **可注释的 Prompt**：以 `//`、`#!`、`#！` 开头的行会在调用 AI 前自动剥离，便于灵活管理 Prompt
- **历史记录**：所有翻译结果本地保存，可一键复用
- **桌面应用**：可用 Pake 打包成独立 .msi 安装包（5-10MB，不依赖 Chrome）

## 🚀 快速开始

### 方式一：浏览器直接打开（推荐用于尝试）

由于 AI 调用涉及跨域，需要关闭浏览器跨域检查才能正常工作。

1. 下载或克隆本仓库
2. 双击 `启动翻译工具.bat`（首次会启动一个独立 Chrome 实例并关闭跨域，仅用于本工具，不要拿它访问别的网站）
3. 在右上角"⚙ API 设置"中填写 API 地址、密钥、模型名，保存即可使用

> 已预装 Chrome 的 Windows 用户都能直接用。其他系统需要手动启动 Chrome 并附加 `--disable-web-security --user-data-dir=<空目录>` 参数。

### 方式二：打包成桌面应用（推荐用于团队分发）

打包成独立 Windows .msi 安装包，不依赖用户系统安装 Chrome，启动后是独立窗口、独立任务栏图标，跟原生软件一样。

**前置依赖**（一次性安装）：

1. [Node.js LTS](https://nodejs.org/)
2. [Rust 工具链](https://rustup.rs/)（rustup-init.exe，全程默认即可）
3. [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/) → 单个组件页面勾选：
   - MSVC v143 - VS 2022 C++ x64/x86 生成工具
   - Windows 11 SDK（最新版即可）
4. 安装完三项后 **重启电脑** 一次（让环境变量生效）

**打包步骤**：

1. 双击 `生成图标.html`，按提示下载 `icon.ico` 到当前文件夹
2. 双击 `一键打包桌面版.bat`
3. 首次打包需 5-15 分钟（Rust 编译 200+ crates），完成后产物在：
   - `Translator.msi`（推荐分发用，约 5-10MB）
   - `pake-cli` 缓存目录下的 `pake-translator.exe`（绿色单文件版）

第二次起打包只要 2-3 分钟（依赖已缓存）。

打包成功后，安装包（`.msi` / `.exe`）会自动复制到 `dist/` 目录（已被 `.gitignore` 忽略，不入库）；需要释放磁盘空间时双击 `clean.bat` 即可清理 `dist/`、`.chrome-profile`、`build-log.txt` 等产物。

### 配置 API

任意 OpenAI 兼容协议的服务都可以接入，包括但不限于：

| 服务 | API Base | 备注 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | 国内需代理 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | 国内需代理 |
| DeepSeek | `https://api.deepseek.com/v1` | 国内可直连，便宜 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 国内可直连 |
| 移动云 MaaS（MiniMax） | `https://api-maas.mobilecloud.com/v1` | 国内可直连 |
| OpenRouter | `https://openrouter.ai/api/v1` | 海外聚合 |

`maxTokens` 默认 4000，遇到模型截断 JSON 可调大。`temperature` 默认 0.7，对追求稳定的场景可降至 0.3。

## 🧮 利润计算器公式

```
净收益价（USD） = (采购价 + 其他费用) ÷ (1 - 净收益利润率) ÷ 汇率
真实利润（CNY） = 净收益价 × 汇率 - (采购价 + 其他费用)
```

固定参数（利润率、汇率、其他费用）保存在 localStorage，跨页面/跨会话保留。

## 📦 数据存储

所有数据均存在浏览器 `localStorage`，**不会上传任何服务器**。Key 列表：

| Key | 用途 |
| --- | --- |
| `translator_profiles_v1` | API 配置 + 字符上限 + 压缩范围 |
| `translator_global_prompt_v1` | 全局 Prompt |
| `translator_history_v1` | 翻译历史 |
| `translator_calc_params_v1` | 计算器固定参数 |
| `translator_fast_mode` | 快速模式开关 |
| `translator_calc_floating_state` | 计算器最小化状态 |

桌面版（WebView2）的数据目录在 `%LOCALAPPDATA%\com.pake.translator\`，与浏览器版不互通。重新打包 .msi 升级安装不会丢数据。

## 🗂️ 项目结构

```
.
├── index.html                  # 主应用（单文件，含全部 UI + 逻辑）
├── icon.svg                    # 应用图标设计源（SVG）
├── 生成图标.html               # 用浏览器从 SVG 生成 icon.png / icon.ico
├── 启动翻译工具.bat            # 启动带 --disable-web-security 的独立 Chrome
├── 启动翻译工具(静默).vbs      # 后台启动 启动翻译工具.bat（无黑窗口）
├── clean.bat                  # 清理构建产物/运行时缓存（不入库）
├── 一键打包桌面版.bat          # 用 Pake 打包成 .msi（产物复制到 dist/）
├── README.md                   # 本文件
├── AGENTS.md                   # 给 AI 协作者的指导
├── LICENSE                     # MIT
└── .gitignore
```

## 🛠️ 二次开发

整个应用是 **单文件 HTML**，所有逻辑都在 `index.html` 一个文件里。直接编辑保存即可，无构建步骤。CSS 走 Tailwind CDN，没有任何 npm 依赖。

修改后想看效果：

- **浏览器版**：刷新页面（Ctrl+R）
- **桌面版**：重新跑 `一键打包桌面版.bat`，安装新 .msi 即可（数据保留）

详细架构、关键函数、本地存储约定见 [AGENTS.md](./AGENTS.md)。

## 🤔 常见问题

**Q：调用 API 报 "Failed to fetch"？**
A：浏览器跨域被拦了。务必通过 `启动翻译工具.bat` 启动（带 `--disable-web-security`），不要直接在普通 Chrome 中双击 index.html。桌面版（WebView2）无此问题。

**Q：AI 返回的 JSON 解析失败？**
A：通常是模型输出被截断。调大 API 配置里的 `maxTokens`（建议 4000+），或降低 `temperature`。

**Q：字符数严格超限怎么办？**
A：超限会触发自动压缩复检（最多 2 轮），并在 UI 上弹出确认提示。如果仍然超限，可以手动微调原标题或全局 Prompt。

**Q：能用国内大模型吗？**
A：能。任何 OpenAI 兼容协议的国内服务（DeepSeek、通义千问、Kimi、智谱、MiniMax 等）都可以接入。

**Q：桌面版会用系统代理吗？**
A：会，WebView2 默认跟随 Windows 系统代理。Clash / V2Ray 开启系统代理后自动生效。

## 📄 License

[MIT](./LICENSE)
