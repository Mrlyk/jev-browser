# jev-browser

面向 AI 模型与 Agent 的浏览器操作 CLI，借助 Jev 模型的毫秒级判断与近乎免费的调用成本，完成点击、填写和内容读取。

[English](README.md) | 简体中文

- **毫秒级模型判断**：Jev 是专注快速结构化判断的模型，模型服务 P50 约 **250 ms**，适合频繁的页面目标判断。
- **近乎免费的调用成本**：Jev 1.13 每百万输入 token 仅 **$0.042**，输出免费。本项目一次真实验证的 32 次 API 请求合计约 **$0.000852**。
- **合并独立判断**：同一步操作中的目标选择与填写值选择可放在一次模型请求中，减少网络往返。

模型延迟与价格来自 [OpenRouter](https://openrouter.ai/typesafe/jev-1.13)（2026-09-19）。完整操作还包含网络、页面快照和浏览器执行；本项目实测见[验证记录](VALIDATION.md)。

## 1. 安装

需要 Node.js 22 或更新版本。当前预编译包支持 macOS Apple Silicon，其他平台按[开发说明](#4-开发说明)从源码构建。

npm 包名为 `jev-browser-cli`，安装后的运行命令为 `jev-browser`：

```bash
npm install -g jev-browser-cli
jev-browser --version
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

`references/` 下的四份指南分别介绍命令、快照、会话与认证、排错。0.1.1 及更新版本支持 `jev-browser skills get jev-browser` 读取主指南；仅在需要全部参考时加 `--full`。

### 直接用语言操作

打开浏览器后，使用 `act` 描述要执行的动作：

```bash
jev-browser --session demo --headed open https://example.com
jev-browser --session demo act '读取 Example Domain 标题'
jev-browser --session demo act '点击 Learn more 链接'
jev-browser --session demo act '返回上一页'
jev-browser --session demo close
```

`--headed` 显示浏览器窗口；使用相同的 `--session` 名称可连续操作同一个浏览器。

操作自己的业务页面时，先用 `open` 打开地址，再描述页面中的实际控件。以下是独立操作示例：

```bash
jev-browser --session hotel act '在“酒店关键词”输入框填写“花园”'
jev-browser --session hotel act '点击搜索酒店按钮'
jev-browser --session hotel act '点击标准大床房区域的预订按钮'
jev-browser --session hotel act '勾选同意预订须知'
```

一次 `act` 执行一个动作，多步流程按顺序调用。填写内容用引号标明；同名控件加上所在区域。返回 `executed` 表示动作完成，业务是否成功仍需检查页面或接口结果。

### 常用控制

```bash
# 已知动作类型时，只让模型选择目标
jev-browser --session hotel act --op fill '入住人姓名输入框' --value '张三'

# 预览选择，不执行动作；用 JSON 输出结果
jev-browser --session hotel act --op click '确认预订按钮' --dry-run --json

# 敏感值从标准输入读取
printf '%s' "$TEST_PASSWORD" | jev-browser --session demo act --op fill '密码输入框' --value-stdin
```

已知选择器时，也可直接使用 `click '#submit'`、`fill '#name' '张三'` 等命令，登录后执行时不调用模型。更多参数见 `jev-browser --help` 和 `jev-browser help`。

## 3. 实现原理简述

- **TypeScript CLI**：解析指令，从页面快照中整理目标候选，并检查模型返回的结果。
- **Jev 模型**：从候选中返回选择及概率；填写值取自用户原文或显式参数，由 CLI 将选择映射为浏览器命令。
- **内置 Rust 执行器**：复用 agent-browser 源码连接浏览器，执行点击、填写等操作，并保持会话。

目标不明确或页面已变化时，工具停止执行；动作派发后结果未知时，不自动重放。

例如 `act '在“姓名”中填写“张三”'`，会先判断动作，再将目标与原文填写值合并提问。指定 `--op` 可省去动作判断；多步操作依次读取最新页面，不会合成一次模型请求。

## 4. 开发说明

源码开发需要 Node.js 22+ 和 Rust stable。在仓库根目录运行：

```bash
npm ci
npm run build:core
npm run build
npm test
node dist/cli.js --help
```

日常修改 `src/` 下的 TypeScript，只需重新运行 `npm run build`；修改 `cli/` 中的 Rust 代码或更新上游后，再运行 `npm run build:core`。

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
