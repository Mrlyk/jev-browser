# 首版验证记录

环境：2026-09-19，macOS ARM64，Node.js 22.22.2，项目隔离 Rust 1.98.1，系统 Chrome。

| 验证项 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript 构建与自动化测试 | 28/28 通过 | Key 组合、双通道 HTTP 请求、响应校验、拒绝执行、参数原样绑定、敏感错误隐藏、候选上下文、原生日期、锁与初始化分支 |
| Rust IPC 回归 | 34/34 通过 | 包含收到动作后断连，确认只收到一次请求并返回 EXECUTION_UNKNOWN |
| Rust 快照回归 | 21/21 通过 | 包含页面与 iframe 文档替换后的引用失效 |
| Rust 参数与配置回归 | 89/89 通过 | fork 的配置目录与参数解析 |
| 中文页面与真实 Chrome | 9/9 通过 | dry-run、普通填写、敏感填写、check、uncheck、select、同名按钮点击、容器文本读取、文本节点读取；模型响应为 synthetic |
| OpenRouter 真实 API | 通过 | `/api/alpha/decisions` + `~typesafe/jev-latest`，响应模型 `typesafe/jev-1.13-20260917` |
| 真实模型中文场景 | 修正后 11/11 通过 | 每步实际请求 Jev，浏览器结果由独立选择器校验；见下表 |
| 真实模型完整 CLI | 1/1 通过 | `act --op fill 姓名输入框 --value-stdin`，独立读取输入框验证写入成功 |
| 普通页面与酒店预订模拟 E2E | 25/25 完整通过 | 真实 OpenRouter + CLI 操作，Playwright 独立断言，视频和业务请求响应证据齐全 |
| 本工具自行启动 Chrome | 通过 | open → snapshot → click → 独立读取文本 123 → close；测试使用独立浏览器 |
| npm 打包及隔离安装 | 通过 | 安装到项目测试 prefix；命令仍指向 dist/cli.js；无模型 Key，PATH 无 Rust/agent-browser，打开、快照、填写、点击、读取、关闭均通过 |
| 格式与补丁检查 | 通过 | cargo fmt --check、git diff --check |

未验证范围：

- TypeSafe 官方直连接口尚未进行真实联调；双 Key 官方优先、不自动切换的规则已经由本地 HTTP 测试验证。
- 本机包仅包含 darwin-arm64 二进制。其他平台尚未构建与验证。
- 本机已有 Chrome，缺少 Chrome 时的实际网络下载未执行；自动准备分支已通过受控测试。
- 未运行上游全部测试，未测所有继承的浏览器原子能力。没有创建 E2E 产品功能、发布 npm 或推送远程仓库。

复现命令见 README.md。运行输出保存在本机被忽略的 .cache/ts-test.log、.cache/rust-test.log、.cache/rust-snapshot-test.log、.cache/rust-flags-test.log 和 .cache/browser-smoke.log。

## 本地模型凭据验证（0.1.1 发布后的源码）

- 自动化测试 34/34 通过，包含两个提供方的最小检查请求、失败保留旧 Key、环境变量覆盖与官方优先、文件权限、损坏文件与符号链接拒绝、stdin 登录及网站认证路由兼容。HTTP 错误、超时和异常响应使用受控数据验证。
- 使用已有授权的 OpenRouter Key 实际执行 `auth login openrouter --with-token`，向 `~typesafe/jev-latest` 发送一次固定文本、单个 choice 问题，请求及校验耗时 1,499 ms。成功保存后核验 status 和 logout；临时测试凭据已删除，报告未记录 Key。
- PTY 验证隐藏输入、退格和 Ctrl-C：Key 未回显，取消时保留原凭据。Skill 主文件与四份参考文档加载检查通过。
- TypeSafe 官方通道通过受控请求测试，本次没有官方真实 Key 联调；本次改动未重新执行浏览器 E2E，也未发布新 npm 版本。

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

## 用户场景与酒店预订模拟 E2E

通过 superharness-e2e-execute 执行，测试消费方为受控普通网站与酒店预订模拟站。每个 case 独立上下文和 CLI 会话；用户操作通过真实 jev-browser CLI，页面与请求由 Playwright 独立断言。模型实际返回 `typesafe/jev-1.13-20260917`。

| 分组 | 用例数 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| 普通访问 | 6 | 页面访问与读取、前进后退、订阅及缺参校验、Enter 搜索、滚动导航、同名歧义 | 6/6 |
| 酒店预订模拟 | 19 | 列表、城市、关键词、早餐、空结果、日期与金额、详情、同名房型按钮、无库存、入住人与电话校验、须知、数量、发票、订单提交、库存及价格失败、非法日期保留原值 | 19/19 |

发现并修复的产品问题：

1. 原生 Date/DateTime 输入框未获得整体引用，语义填写只能看到内部年月日片段。已增加整体引用和候选，填写日期时排除内部片段。
2. 上游 fill 依赖键盘插入，原生日期会被清空而未正确写入。已先校验格式，再用原生 setter 赋值并触发 input/change；非法格式保留原值。

第一轮回放配置未登记 POST 参数条件，导致业务请求被严格回放拦截；该轮存在失败和输入变更，未计为通过。修正匹配合同后完整重跑。酒店响应内容未为适配失败断言而改变。

最终回执：executionVerdict=pass、evidenceVerdict=complete，25 passed / 0 failed / 0 skipped / 0 flaky。报告文件完整性校验 125/125 通过。模型概率阈值仍为 0.85，差值阈值仍为 0.20，未启用重试。

本轮执行 159,439 ms（约 2 分 39 秒）；总处理 1,394,899 ms（约 23 分 15 秒，含分析、编写、修正与两轮执行，扣除安装）；累计脚本执行 324,476 ms。时间来自 runner session-clock 与 Playwright stats。

本地 synthetic 数据包含 4 个业务接口、11 个响应变体；业务上游计数为 0。成功预订独立核对了 h1/r1、2026-10-10 至 2026-10-12、入住人张三、金额 ¥640 和回执 MOCK-9001。不涉及真实库存、酒店订单或付款。

任务目录：`.superharness/tasks/09-19-jev-usage-hotel/e2e/`。

- 完整报告：`evals/2026-09-19T09-28-14-089Z-075e7576/test-report.html`。
- 完整结果：同目录 `qa-issues.json`、`playwright.json`、`execution.json`。
- 摘要：`e40b9d650a125906468948a14efacba1f22b7b0f90011a130c830ce851c8323f`。
- 历史失败：`evals/2026-09-19T09-21-00-696Z-366247c8/`，原样保留。
- 用例、测试站、冻结 Mock 和来源回执保存在任务 `playwright/` 下，可由 discover 复用；整个 e2e 目录按技能规则不提交。
