# jev-browser

面向 AI 模型与 Agent 的浏览器操作 CLI，借助 Jev 模型的毫秒级判断与近乎免费的调用成本，完成点击、填写和内容读取。

[English](README.md) | 简体中文

- **毫秒级模型判断**：Jev 是专注快速结构化判断的模型，模型服务 P50 约 **250 ms**，适合频繁的页面目标判断。
- **近乎免费的调用成本**：Jev 1.13 每百万输入 token 仅 **$0.042**，输出免费。本项目一次真实验证的 32 次 API 请求合计约 **$0.000852**。
- **合并独立判断**：同一步操作中的目标选择与填写值选择可放在一次模型请求中，减少网络往返。

模型延迟与价格来自 [OpenRouter](https://openrouter.ai/typesafe/jev-1.13)（2026-09-19）。完整操作还包含网络、页面快照和浏览器执行；本项目实测见[验证记录](VALIDATION.md)。

## 1. 安装

需要 Node.js 22 或更新版本。当前预编译包支持 macOS Apple Silicon，其他平台按[开发说明](#4-开发说明)从源码构建。

npm 包名为 `jev-browser-cli`，安装后可使用 `jevb` 或 `jev-browser`，两者等价：

```bash
npm install -g jev-browser-cli
jevb --version
```

安装包自带浏览器执行器，无需单独安装 agent-browser 或 Rust。首次打开页面时会查找 Chrome，缺少时自动下载。Linux 需要浏览器系统依赖；Linux ARM64 请先安装 Chromium，并通过 `--executable-path` 指定路径。

### 复制给 Agent

将下面的提示词粘贴给编程 Agent，让它安装 CLI 和配套 Skill：

```text
执行 `npm install -g jev-browser-cli` 安装 jev-browser CLI，
再执行 `npx skills add Mrlyk/jev-browser --skill jev-browser` 安装配套 Skill，
并选择你当前使用的 Agent。读取 Skill：
https://github.com/Mrlyk/jev-browser/blob/master/skills/jev-browser/SKILL.md
之后在本项目的浏览器任务中使用这个 Skill。
```

## 2. 使用

### CLI 命令

采用 `jevb <资源> <动作> <会话名> [对象] [选项]`，例如 `jevb page act demo "搜索 jev"`、`jevb session close demo`。会话名必填，旧的 `--session` 写法会提示迁移；不会使用环境变量或默认会话替代。

`session list`、`auth login/status/logout`、`browser install/inspect/doctor`、`skill`、`profile` 等公共命令不需要会话名。`browser connect/configure`、`state save/load` 需要会话名；网站账号登录使用 `auth login <会话名> <账号名>`。下表省略浏览器动作中的会话参数。

| 资源 | 动作与用途 |
| --- | --- |
| `session` | `list` 列表、`inspect <name>` 详情、`close <name>` 关闭、`close --all` 关闭全部、`current` 默认名称、`id` 生成名称 |
| `browser` | `connect <端口或URL>` 连接已有浏览器、`inspect` 调试地址、`install` 安装浏览器、`doctor` 诊断、`configure` 配置 |
| `page` | `open <URL>` 导航、`act <指令>` 自然语言操作、`back/forward/reload` 导航控制、`snapshot` 快照、`read/get` 读取、`wait` 等待、`scroll` 滚动、`screenshot/pdf` 导出 |
| `element` | `click/dblclick` 点击、`fill/type` 输入、`check/uncheck/select` 选择、`hover/focus` 定位、`get/is/find` 查询、`drag/upload/download/scrollintoview/highlight` 操作 |
| `tab` / `window` / `frame` | `tab list/create/switch/close` 管理标签页，`window create` 新建窗口，`frame switch/main` 切换框架 |
| `keyboard` / `mouse` / `touch` | 键盘 `press/down/up/type/inserttext`、鼠标操作、触摸 `tap/swipe` |
| `cookie` / `storage` / `state` | Cookie `list/set/clear`、网页存储、登录状态 `save/load/list/show/clear/clean/rename` |
| `auth` | `login/status/logout` 配置模型凭据；网站登录沿用对应子命令 |
| `network` / `dialog` / `clipboard` | 网络控制、对话框 `status/accept/dismiss`、剪贴板读写 |
| `console` / `trace` / `profiler` / `record` | 日志 `list/errors/clear`、浏览器追踪、性能分析、视频录制 |
| `skill` / `profile` / `script` | 技能 `list/get/path`、浏览器档案 `list`、初始化脚本 `remove` |
| `approval` / `stream` / `device` / `plugin` / `webmcp` / `server` | 执行器 `confirm/deny`、画面流、设备、插件、页面工具，以及 `server start` 启动 MCP |

`page` 还提供 `eval/diff/react/vitals/a11y/pushstate/batch`。通过分组帮助查看完整动作和参数：

```bash
jevb --help
jevb page --help
jevb page open --help
jevb page open demo --headed https://www.baidu.com
jevb page act demo '点击搜索框'
jevb session inspect demo
jevb session close demo
```

旧的顶层 `open/act/click/close` 等入口已移除，调用时会提示对应的资源命令；例如 `close demo` 改为 `session close demo`，`act` 改为 `page act`。自动化脚本和 Agent 指令也需要同步修改。

### 为什么同时提供 act 和 open

`page act` 将自然语言交给 Jev 判断，再调用底层浏览器动作；`page open` 和 `element click` 等确定性命令供已知网址或选择器的脚本直接执行，省去模型判断。两类入口共用执行器，自然语言操作也可以完成导航，无须固定先执行 `page open`。

目前 CLI 的 `page act` 打开网站需要完整 URL，例如 `jevb page act demo '打开 https://www.baidu.com'`。插件另外实现了网站名称映射，因此能识别“打开 baidu”；CLI 尚未提供这层映射。

### 配置模型

准备 OpenRouter 或 TypeSafe API Key，登录一次即可：

```bash
jev-browser auth login             # 输入 Key 登录
jev-browser auth status            # 查看当前提供方
jev-browser auth logout openrouter # 删除已保存的 Key
```

CI 也可使用环境变量：

```bash
export OPENROUTER_API_KEY="你的 OpenRouter Key"
# 或：export TYPESAFE_API_KEY="你的 TypeSafe Key"
```

首次使用时会提示登录，成功后继续原命令。非交互环境可通过 `auth login --with-token` 从标准输入登录。

同一提供方优先使用环境变量；两个提供方都有 Key 时优先 TypeSafe。

### 与其他模型或 Agent 配合

为调用方模型提供终端工具，并加载 [jev-browser 配套 Skill](skills/jev-browser/SKILL.md)。调用方负责规划步骤和检查结果，CLI 使用 Jev 选择目标，每次执行一个浏览器动作。

配套 Skill 位于 `skills/jev-browser/`。支持 Skill 的 Agent 可加载该目录；其他模型可先读取 `SKILL.md`，再按其中的说明调用 CLI。

`references/` 下的四份指南分别介绍命令、快照、会话与认证、排错。0.1.1 及更新版本支持 `jev-browser skill get jev-browser` 读取主指南；仅在需要全部参考时加 `--full`。

### 直接用语言操作

打开浏览器后，使用 `page act` 描述要执行的动作：

```bash
jev-browser page open demo --headed https://example.com
jev-browser page act demo '读取 Example Domain 标题'
jev-browser page act demo '点击 Learn more 链接'
jev-browser page act demo '返回上一页'
jev-browser session close demo
```

`--headed` 显示浏览器窗口；在动作后填写相同的会话名可连续操作同一个浏览器。

用完后执行 `jev-browser session close demo`，成功时显示 `Closed session: demo`。会话名必填，或使用 `session close --all` 关闭全部会话；会话名不能与 `--all` 混用。连接自己的 Chrome 时，关闭会话只断开控制连接。

操作自己的业务页面时，可用 `page open` 打开地址，再描述页面中的实际控件。以下是独立操作示例：

```bash
jev-browser page act hotel '在“酒店关键词”输入框填写“花园”'
jev-browser page act hotel '点击搜索酒店按钮'
jev-browser page act hotel '点击标准大床房区域的预订按钮'
jev-browser page act hotel '勾选同意预订须知'
```

一次 `page act` 执行一次操作，支持 `page act demo '搜索 jev'` 这样的输入并提交；其他独立多步流程按顺序调用。Jev 并行判断动作、输入框、输入内容、是否清空和是否回车。复杂的填写内容可用引号标明，同名控件加上所在区域。返回 `executed` 表示操作完成，业务是否成功仍需检查页面或接口结果。

不够确定时，CLI 展示页面、目标、输入内容、是否清空和提交，以及需要确认的原因。终端中输入 `y` 执行，其他输入取消。`--json` 或非交互调用返回 `needs_confirmation` 和确认编号，按返回的命令继续：

```bash
jev-browser page act demo --confirm <确认编号>
jev-browser page act demo --cancel <确认编号>
```

确认编号限原会话使用，5 分钟内有效，只能处理一次。确认会复核页面和目标，执行已展示的计划。`--dry-run` 始终不执行，也不创建可执行的确认编号。`--value` 和标准输入的内容不会回显；待确认计划临时保存在仅当前用户可读的文件中，确认或取消后删除。

### 常用控制

```bash
# 已知动作类型时，只让模型选择目标
jev-browser page act hotel --op fill '入住人姓名输入框' --value '张三'

# 预览选择，不执行动作；用 JSON 输出结果
jev-browser page act hotel --op click '确认预订按钮' --dry-run --json

# 敏感值从标准输入读取
printf '%s' "$TEST_PASSWORD" | jev-browser page act demo --op fill '密码输入框' --value-stdin
```

已知选择器时，也可直接使用 `element click demo '#submit'`、`element fill demo '#name' '张三'` 等命令，登录后执行时不调用模型。更多参数见 `jev-browser --help` 和 `jev-browser help`。

## 3. 实现原理简述

- **TypeScript CLI**：解析指令，从页面快照中整理目标候选，并检查模型返回的结果。
- **Jev 模型**：从候选中返回选择及概率；填写值取自用户原文或显式参数，由 CLI 将选择映射为浏览器命令。
- **内置 Rust 执行器**：复用 agent-browser 源码连接浏览器，执行点击、填写等操作，并保持会话。

相关判断未达到阈值时，工具等待确认；没有有效目标或页面已变化时停止执行。输入与提交之间也会复核目标，已部分执行或结果未知时不自动重放。

例如 `page act demo '搜索 jev'`，在一次请求中并行判断各个操作要素，只使用相关分支的结果。任何相关判断不够确定都会进入确认流程。指定 `--op fill/type` 时保留明确的清空/追加行为，不自动回车。

## 4. 开发说明

源码开发需要 Node.js 22+ 和 Rust stable。在仓库根目录运行：

```bash
npm run dev
```

这一个命令会安装锁定的开发依赖、构建 Rust 执行器和 TypeScript，再把当前仓库链接到全局的 `jevb` 与 `jev-browser`。任何准备步骤失败都会停止，不替换全局命令。修改源码后重新运行 `npm run dev` 即可更新开发版本。

之后可在任意目录直接测试：

```bash
jevb page open demo https://www.baidu.com --headed
jevb page act demo "搜索 jev"
jevb session close demo
```

恢复正式安装时，使用同一套 Node/npm 执行下面的命令，会覆盖开发链接，仓库文件保留：

```bash
npm install -g jev-browser-cli@latest
```

`npm test` 执行功能回归。仅需重新编译 TypeScript 时也可运行 `npm run build`。

打包：

```bash
node scripts/licenses.mjs
npm pack
```

生成的 `jev-browser-cli-0.1.3.tgz` 包含本机执行器。

构建并发布到 npm：

```bash
npm run publish -- --dry-run  # 构建并预览发布，不上传
npm run publish              # 构建并发布，需要对应 registry 的发布权限
```

命令依次构建 Rust 执行器和 TypeScript、整理许可证、校验安装包，再执行发布；任一步失败即停止。`--tag`、`--registry` 等 npm 参数可放在 `--` 后。当前流程只编译本机平台，安装包包含 `libexec/` 中已准备的平台二进制。

连接专用测试浏览器后，可运行 `JEV_TEST_CDP=9222 npm run test:smoke`；配置 OpenRouter Key 后，可运行 `JEV_TEST_CDP=9222 npm run test:live`。已执行的用例和范围见 [VALIDATION.md](VALIDATION.md)。

构建执行器后，运行 `npm run test:skills` 检查技能发现、参考文档加载与旧入口退役，无需启动浏览器。

## 5. 开源协议

采用 [Apache-2.0](LICENSE)。浏览器执行能力基于 [agent-browser](https://github.com/vercel-labs/agent-browser) 源码，版本和修改记录见 [UPSTREAM.json](UPSTREAM.json)，第三方授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
