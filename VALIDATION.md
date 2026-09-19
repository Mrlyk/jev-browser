# 首版验证记录

环境：2026-09-19，macOS ARM64，Node.js 22.22.2，项目隔离 Rust 1.98.1，系统 Chrome。

| 验证项 | 结果 | 范围 |
| --- | --- | --- |
| TypeScript 构建与自动化测试 | 21/21 通过 | Key 组合、双通道 HTTP 请求、响应校验、拒绝执行、参数原样绑定、敏感错误隐藏、候选上下文、锁与初始化分支 |
| Rust IPC 回归 | 34/34 通过 | 包含收到动作后断连，确认只收到一次请求并返回 EXECUTION_UNKNOWN |
| Rust 快照回归 | 21/21 通过 | 包含页面与 iframe 文档替换后的引用失效 |
| Rust 参数与配置回归 | 89/89 通过 | fork 的配置目录与参数解析 |
| 中文页面与真实 Chrome | 9/9 通过 | dry-run、普通填写、敏感填写、check、uncheck、select、同名按钮点击、容器文本读取、文本节点读取；模型响应为 synthetic |
| 本工具自行启动 Chrome | 通过 | open → snapshot → click → 独立读取文本 123 → close；测试使用独立浏览器 |
| npm 打包及隔离安装 | 通过 | 安装到项目测试 prefix；命令仍指向 dist/cli.js；无模型 Key，PATH 无 Rust/agent-browser，打开、快照、填写、点击、读取、关闭均通过 |
| 格式与补丁检查 | 通过 | cargo fmt --check、git diff --check |

未验证范围：

- 当前环境未配置 TYPESAFE_API_KEY、OPENROUTER_API_KEY，真实官方 API、OpenRouter latest 别名及中文模型准确率未联调。HTTP 测试使用本地服务验证协议和选路。
- 本机包仅包含 darwin-arm64 二进制。其他四个平台的 CI 构建尚未执行，GitLab runner tags 需要在对应项目配置。
- 本机已有 Chrome，缺少 Chrome 时的实际网络下载未执行；自动准备分支已通过受控测试。
- 未运行上游全部测试，未测所有继承的浏览器原子能力。没有创建 E2E 产品功能、发布 npm 或推送远程仓库。

复现命令见 README.md。运行输出保存在本机被忽略的 .cache/ts-test.log、.cache/rust-test.log、.cache/rust-snapshot-test.log、.cache/rust-flags-test.log 和 .cache/browser-smoke.log。
