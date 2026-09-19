# 首版验证记录

环境：2026-09-19，macOS ARM64，Node.js 22.22.2，项目隔离 Rust 1.98.1，系统 Chrome。

| 验证项 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript 构建与自动化测试 | 21/21 通过 | Key 组合、双通道 HTTP 请求、响应校验、拒绝执行、参数原样绑定、敏感错误隐藏、候选上下文、锁与初始化分支 |
| Rust IPC 回归 | 34/34 通过 | 包含收到动作后断连，确认只收到一次请求并返回 EXECUTION_UNKNOWN |
| Rust 快照回归 | 21/21 通过 | 包含页面与 iframe 文档替换后的引用失效 |
| Rust 参数与配置回归 | 89/89 通过 | fork 的配置目录与参数解析 |
| 中文页面与真实 Chrome | 9/9 通过 | dry-run、普通填写、敏感填写、check、uncheck、select、同名按钮点击、容器文本读取、文本节点读取；模型响应为 synthetic |
| OpenRouter 真实 API | 通过 | `/api/alpha/decisions` + `~typesafe/jev-latest`，响应模型 `typesafe/jev-1.13-20260917` |
| 真实模型中文场景 | 修正后 11/11 通过 | 每步实际请求 Jev，浏览器结果由独立选择器校验；见下表 |
| 真实模型完整 CLI | 1/1 通过 | `act --op fill 姓名输入框 --value-stdin`，独立读取输入框验证写入成功 |
| 本工具自行启动 Chrome | 通过 | open → snapshot → click → 独立读取文本 123 → close；测试使用独立浏览器 |
| npm 打包及隔离安装 | 通过 | 安装到项目测试 prefix；命令仍指向 dist/cli.js；无模型 Key，PATH 无 Rust/agent-browser，打开、快照、填写、点击、读取、关闭均通过 |
| 格式与补丁检查 | 通过 | cargo fmt --check、git diff --check |

未验证范围：

- TypeSafe 官方直连接口尚未进行真实联调；双 Key 官方优先、不自动切换的规则已经由本地 HTTP 测试验证。
- 本机包仅包含 darwin-arm64 二进制。其他四个平台的 CI 构建尚未执行，GitLab runner tags 需要在对应项目配置。
- 本机已有 Chrome，缺少 Chrome 时的实际网络下载未执行；自动准备分支已通过受控测试。
- 未运行上游全部测试，未测所有继承的浏览器原子能力。没有创建 E2E 产品功能、发布 npm 或推送远程仓库。

复现命令见 README.md。运行输出保存在本机被忽略的 .cache/ts-test.log、.cache/rust-test.log、.cache/rust-snapshot-test.log、.cache/rust-flags-test.log 和 .cache/browser-smoke.log。

## OpenRouter 真实验证

首轮 10/11 通过。读取“操作结果区域”时，模型在状态容器与其中的文本节点之间返回 ambiguous，工具停止且未派发动作。补充 get_text 的容器与文本节点选择规则后，同一组场景 11/11 通过；目标概率 0.91，继续使用原来的 0.85 概率和 0.20 差值阈值。

| 场景 | 最终结果 | 场景耗时 |
| --- | --- | --- |
| dry-run | resolved，页面未改变 | 1,578 ms |
| 中文同名按钮 | 点击入住信息的确认，未点击发票确认 | 2,242 ms |
| 显式填写 | 输入内容原样保留 | 1,191 ms |
| 引号原文绑定 | 选择“李四”作为填写值 | 2,517 ms |
| 中文勾选 | 复选框状态为 true | 2,205 ms |
| 下拉标签 | “2人”映射到原生 option value=2 | 1,133 ms |
| 读取区域文本 | 返回“等待操作” | 1,349 ms |
| 目标不存在 | NO_MATCH，页面未改变 | 1,142 ms |
| 同名歧义 | AMBIGUOUS，页面未改变 | 1,341 ms |
| 多步拒绝 | MULTI_STEP_UNSUPPORTED，页面未改变 | 893 ms |
| 否定指令 | UNSUPPORTED_OPERATION，页面未改变 | 907 ms |
| 完整 CLI + stdin | executed，输入框为“CLI 真实验证” | 3,265 ms |

11 个语义场景的耗时中位数为 1,341 ms，包含测试页重置、模型网络请求、目标复核和独立浏览器断言。覆盖范围为固定中文测试页。两轮场景测试和额外 CLI 验证共请求 32 次，OpenRouter 响应累计 input_tokens=20,288、usage.cost=$0.000852096；该费用仅为本次模型 API 请求费用。

来源记录：

- `.cache/live-validation-1789808365703.json`：首轮及读取歧义证据。
- `.cache/live-validation-1789808470676.json`：修正后 11/11。
- `.cache/live-validation-1789808541446.json`：完整 CLI 与 stdin。

Key 通过临时进程环境传入，没有写入项目文件或测试报告。
