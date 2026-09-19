# jev-browser

TypeScript 编写的 Jev 语义浏览器 CLI，内置从 agent-browser v0.38.1 源码构建的 Rust 执行器。一次 `act` 选择并执行一个浏览器原子动作。

## 使用

要求 Node.js 22 或更新版本。发行包内置平台二进制，用户无需安装 agent-browser 或 Rust。当前仓库尚未发布 npm；本地构建方式见下文。

```bash
# 安装构建好的发行包
npm install -g ./jev-browser-0.1.0.tgz

# 确定性命令不需要模型 Key
jev-browser --session demo --headed open https://example.com
jev-browser --session demo snapshot --json
jev-browser --session demo click @e1

# 官方或 OpenRouter 配置其中一个即可
export TYPESAFE_API_KEY="你的官方 Key"
# export OPENROUTER_API_KEY="你的 OpenRouter Key"

jev-browser --session demo act "点击入住信息区域的确认按钮"
jev-browser --session demo act --op fill "姓名输入框" --value "张三"
jev-browser --session demo act --op click "确认按钮" --scope '#guest' --dry-run --json
jev-browser --session demo close
```

首次 `open` 会使用已有 Chrome；没有可用浏览器时自动调用内置下载器准备 Chrome for Testing。下载需要网络与可写目录。Linux ARM64 需要系统 Chromium（Google 不提供该平台的 Chrome for Testing）；Linux 系统库由管理员准备。可用 `--executable-path` 指定浏览器。连接已有 CDP 时无需本地下载：

```bash
jev-browser --session existing connect 9222
jev-browser --session existing act --op click "搜索按钮"
jev-browser --session remote --cdp 'ws://localhost:9222/devtools/browser/...' snapshot --json
```

CDP 浏览器需要自行开放调试端口，并使用独立用户数据目录。默认受控会话由工具启动并复用。

## 模型通道

| 配置 | 调用通道 | 默认模型 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` 非空 | TypeSafe 官方 | `jev-latest` |
| 只有 `OPENROUTER_API_KEY` 非空 | OpenRouter | `~typesafe/jev-latest` |
| 两个都有 | TypeSafe 官方 | `jev-latest` |
| 两个都没有 | `act` 返回 `MISSING_API_KEY` | 原子命令仍可用 |

官方使用 `POST https://api.typesafe.ai/v1/systemone`，OpenRouter 使用 `POST https://openrouter.ai/api/alpha/decisions`。两者共用 `state + questions`。分别通过 `TYPESAFE_MODEL`、`OPENROUTER_MODEL` 固定版本；输出记录实际返回的模型版本。模型请求超时 30 秒，首版不自动重试或切换通道。

协议来源：[TypeSafe API](https://docs.typesafe.ai/api)、[OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)、[OpenRouter latest 别名](https://openrouter.ai/~typesafe/jev-latest)。

Key 只在 Node 进程中读取；启动 Rust 执行器前移除两个模型 Key。`--value` 不进入模型请求。敏感值可经标准输入传入：

```bash
printf '%s' "$TEST_PASSWORD" | jev-browser --session demo act --op fill "密码输入框" --value-stdin
```

标准输入原样保留，包括末尾换行。内部通过单条 JSON batch 的 stdin 传值，不放进子进程命令行，也不回显写入值。页面快照中的其他可见内容仍可能成为模型候选。

## 支持范围

| 入口 | 能力 |
| --- | --- |
| 原子命令 | 继承导航、观察、点击、填写、截图、键鼠、标签页、frame、上传下载、网络与存储操作 |
| `act` | click、dblclick、fill、type、check、uncheck、hover、focus、select、scrollintoview、get_text、open、back、forward、reload、scroll、press |

`act --op` 把文字当作目标描述；完整 `act` 先选择操作类型。填写值来自 `--value`、stdin 或用户指令中的引号片段。`select` 支持原生下拉框的值或可见标签；自定义下拉组件需要分步调用。`scroll` 首版每次滚动 500 px；`press` 支持帮助和源码动作表中的常用按键与组合键。

```bash
jev-browser act '在“姓名”中填写“张三”'
jev-browser act '向下滚动'
jev-browser act --op press '按回车' --value Enter
jev-browser act --op open '打开网站' --value https://example.com
```

首版没有任务规划、多步自动执行、E2E 框架、截图识别、扩展、MCP Server 或公开 SDK。`dashboard` 暂未打包；`upgrade` 提示更新整个 npm 包。`jev-browser help` 可查看上游原子命令说明，底层帮助保留部分上游名称。

## 执行约束与返回

- 每个目标题最多 253 个目标，另加 none、ambiguous；超限要求 `--scope <CSS>`，不截断候选。模型请求 JSON 最大 48 KB。
- 默认最高选项概率至少 0.85，领先第二名至少 0.20；可用 `--min-probability`、`--min-margin` 调整。这些工程初值尚未经过真实 Jev 中文数据集校准。
- 同会话从观察到执行持有文件锁，并发调用返回 `SESSION_BUSY`。异常进程留下的锁需确认 PID 已结束后手动清理，工具不抢占锁。
- 执行前复核页面、frame、DOM 节点、引用、名称、区域和可操作状态。无法确认 DOM 身份的虚拟节点返回 `STALE_TARGET`。外部人工操作与最终派发之间仍存在时间窗口。
- `--dry-run` 返回 `resolved`，不派发动作。成功执行返回 `executed`，表示原子动作完成，业务结果需调用方独立验证。
- 派发后连接中断或超时返回 `EXECUTION_UNKNOWN`，禁止自动重放。标准输出用于结果；错误退出码为 1，错误 JSON 含 `code`、`message`、`dispatched`。

`--json` 包含目标、候选数量、快照标识、每次模型选择与概率、通道、用量和各阶段耗时。默认不将网页快照或模型请求写入磁盘。

原版状态与本工具隔离：配置文件为 `jev-browser.json`、用户配置与授权状态在 `~/.jev-browser/`；socket 和锁默认在临时目录 `jvb-<uid>`，可用 `JEV_BROWSER_RUNTIME_DIR` 更改。运行配置用 `JEV_BROWSER_` 前缀，原版 `AGENT_BROWSER_` 环境配置不会被继承。显式传入的 profile、state 和下载路径由调用方控制。

## 开发与打包

```bash
npm ci
npm run build:core    # 首次、修改 Rust 或更新上游时需要当前 stable Rust
node scripts/licenses.mjs
npm run build
node dist/cli.js --help
npm test
npm pack
```

日常语义开发只修改 `src/`，执行 `npm run build`；Rust 源码保留在 `cli/`。`libexec/` 是构建产物，不提交二进制。`npm pack` 会检查当前平台执行器存在，npm 入口始终为 JavaScript，无改写入口的 postinstall。

`.gitlab-ci.yml` 定义五个平台的原生构建及合并打包：macOS ARM64/x64、Linux x64/ARM64、Windows x64。对应 runner 需要 Node.js 22+、当前 stable Rust，并配置文件中声明的 runner tags。设置 `JEV_RELEASE=1` 打包时强制检查所有平台文件；流水线只产出 tarball，不发布 npm。当前本地打包只包含本机平台。

验证真实浏览器执行可连接任务专用 Chrome：

```bash
JEV_TEST_CDP=9222 npm run test:smoke
```

该测试使用本地页面和标记为 `synthetic` 的模型选择，独立断言填写值、勾选状态、下拉值及中文按钮效果；它验证执行链路，不测模型语义准确率。真实 API 联调需要自行配置 Key 后运行 `act`。

## 来源与许可证

基于 agent-browser 源码 fork，固定到 v0.38.1 / aff6125c023b810ea3f2e5deec5379e9a4270bdc。未通过 npm 依赖、全局 PATH 或 npx 调用 agent-browser。项目采用 Apache-2.0，来源与补丁记录见 UPSTREAM.json，第三方声明见 THIRD_PARTY_NOTICES.md。
