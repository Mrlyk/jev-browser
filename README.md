# jev-browser

用自然语言操作浏览器的命令行工具，支持点击、填写、选择和页面内容读取。

适用场景：

- 让 AI Agent 按页面含义查找并操作控件。
- 编写信息查询、表单填写、酒店预订等浏览器自动化脚本。
- 在 E2E 测试中用语言描述操作，用独立断言验证结果。

## 1. 安装

需要 Node.js 22 或更新版本。当前尚未发布到 npm，使用与你的平台匹配的 `.tgz` 安装包；没有安装包时，按[开发说明](#4-开发说明)从源码构建。

```bash
npm install -g ./jev-browser-0.1.0.tgz
jev-browser --version
```

安装包自带浏览器执行器，无需单独安装 agent-browser 或 Rust。首次打开页面时会查找 Chrome，缺少时自动下载。Linux 需要浏览器系统依赖；Linux ARM64 请先安装 Chromium，并通过 `--executable-path` 指定路径。

## 2. 使用

### 配置模型

准备一个 OpenRouter 或 TypeSafe API Key，任选一种配置：

```bash
export OPENROUTER_API_KEY="你的 OpenRouter Key"
# 使用官方接口时改为：export TYPESAFE_API_KEY="你的 TypeSafe Key"
```

两个 Key 都配置时优先使用 TypeSafe 官方接口；请求失败不会自动切换通道。

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

已知选择器时，也可直接使用 `click '#submit'`、`fill '#name' '张三'` 等命令，无需模型 Key。更多参数见 `jev-browser --help` 和 `jev-browser help`。

## 3. 实现原理简述

- **TypeScript CLI**：解析指令，从页面快照中整理目标候选，并检查模型返回的结果。
- **Jev**：从给定候选中选择，不生成浏览器脚本；填写值取自用户原文或显式参数。
- **内置 Rust 执行器**：复用 agent-browser 源码连接浏览器，执行点击、填写等操作，并保持会话。

目标不明确或页面已变化时，工具停止执行；动作派发后结果未知时，不自动重放。

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

生成的 `jev-browser-0.1.0.tgz` 包含本机执行器。跨平台构建见 [.gitlab-ci.yml](.gitlab-ci.yml)。

连接专用测试浏览器后，可运行 `JEV_TEST_CDP=9222 npm run test:smoke`；配置 OpenRouter Key 后，可运行 `JEV_TEST_CDP=9222 npm run test:live`。已执行的用例和范围见 [VALIDATION.md](VALIDATION.md)。

## 5. 开源协议

采用 [Apache-2.0](LICENSE)。浏览器执行能力基于 [agent-browser](https://github.com/vercel-labs/agent-browser) 源码，版本和修改记录见 [UPSTREAM.json](UPSTREAM.json)，第三方授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
