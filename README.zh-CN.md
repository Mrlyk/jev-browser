# jev-browser

面向 AI Agent 的浏览器 CLI，用 Jev 理解自然语言，执行搜索、点击、填写和内容读取。

[English](README.md) | 简体中文

## 1. 安装

需要 Node.js 22+。预编译包支持 macOS Apple Silicon；其他平台需按[本地开发](#4-本地开发)从源码构建。

```bash
npm install -g jev-browser-cli
```

安装后使用 `jevb`，也可使用等价的 `jev-browser`。首次打开页面时会查找 Chrome，缺少时自动下载。

### 复制给 Agent

将下面的提示词粘贴给编程 Agent，让它安装 CLI 和配套 Skill：

```text
执行 `npm install -g jev-browser-cli` 安装 jev-browser CLI，
再执行 `npx skills add Mrlyk/jev-browser --skill jev-browser` 安装配套 Skill，
并选择你当前使用的 Agent。读取 Skill：
https://github.com/Mrlyk/jev-browser/blob/master/skills/jev-browser/SKILL.md
之后在本项目的浏览器任务中使用这个 Skill。
```

## 2. 配置模型

准备 TypeSafe 或 OpenRouter API Key，登录一次：

```bash
jevb auth login
jevb auth status
```

CI 可通过 `TYPESAFE_API_KEY` 或 `OPENROUTER_API_KEY` 配置，例如：

```bash
export TYPESAFE_API_KEY="你的 API Key"
```

同一提供方优先使用环境变量；两家都有 Key 时优先 TypeSafe。非交互登录、退出和凭据管理见[认证指南](skills/jev-browser/references/sessions-auth.md#model-api-keys)。

## 3. 使用命令

### 完成一次操作

```bash
jevb page open demo https://www.baidu.com --headed
jevb page act demo "搜索 jev"
jevb page snapshot demo
jevb session close demo
```

`demo` 是会话名，放在动作后；连续操作使用同一个名字。`--headed` 显示浏览器窗口。

浏览器操作的格式为 `jevb <资源> <动作> <会话名> [对象] [选项]`。`auth login`、`session list` 等公共命令不需要会话名。

`page act` 接收自然语言；已知网址、选择器或按键时，可以直接使用 `page open`、`element click`、`keyboard press` 等命令，省去模型判断。

一次 `page act` 执行一项操作，搜索可包含输入和回车。其他多步任务分开调用。

打开常用网站可直接说名称，例如 `jevb page act demo "打开Google" --headed`。内置 30 个站点，支持常见中英文名称和别名：

| 类别 | 站点 |
| --- | --- |
| 搜索与百科 | Google（谷歌）、百度、Bing（必应）、DuckDuckGo、Yahoo（雅虎）、Wikipedia（维基百科） |
| 开发 | GitHub、GitLab、Stack Overflow、CSDN、掘金、npm |
| 购物 | 淘宝、京东、天猫、Amazon（亚马逊） |
| 社交与社区 | 知乎、豆瓣、微博、小红书、X（Twitter）、Reddit、Facebook、Instagram、LinkedIn（领英） |
| 视频与音乐 | B站、YouTube（油管）、抖音、Netflix（奈飞）、Spotify |

其他网站请提供完整网址，例如 `jevb page act demo "打开 https://example.com"`。

网站未匹配时，终端会提示输入完整网址，直接回车取消；`--json` 或非交互调用返回 `NEEDS_URL` 和重试示例。网站匹配不够确定时仍需确认，`--dry-run` 只预览。

### 常用命令

表内的选择器和标签页 ID 需按实际页面替换。参数详情可用 `jevb <资源> <动作> --help` 查看。

| 命令 | 用途 | 示例 |
| --- | --- | --- |
| `page open` | 打开网页 | `jevb page open demo https://www.baidu.com --headed` |
| `page act` | 执行自然语言指令 | `jevb page act demo "搜索 jev"` |
| `page snapshot` | 查看页面元素及引用 | `jevb page snapshot demo --json` |
| `page get` | 读取页面信息 | `jevb page get demo title` |
| `page wait` | 等待页面出现指定内容 | `jevb page wait demo --text "已完成"` |
| `element click` | 点击元素 | `jevb element click demo '#submit'` |
| `element fill` | 清空后填写 | `jevb element fill demo '#name' '张三'` |
| `element type` | 在末尾追加文字 | `jevb element type demo '#name' '先生'` |
| `keyboard press` | 按键 | `jevb keyboard press demo Enter` |
| `tab list` | 查看标签页 | `jevb tab list demo` |
| `tab switch` | 切换标签页 | `jevb tab switch demo t2` |
| `page screenshot` | 保存截图 | `jevb page screenshot demo page.png` |
| `console errors` | 查看页面错误 | `jevb console errors demo` |
| `session list` | 查看运行中的会话 | `jevb session list` |
| `session inspect` | 查看会话详情 | `jevb session inspect demo` |
| `session close` | 关闭指定会话 | `jevb session close demo` |
| `session clear` | 一次关闭全部运行中的会话 | `jevb session clear` |
| `browser connect` | 连接已开启调试端口的浏览器 | `jevb browser connect demo 9222` |
| `state save` | 保存登录状态 | `jevb state save demo auth.json` |

完整命令分组见 `jevb --help`。更多示例见[命令指南](skills/jev-browser/references/commands.md)，页面引用和会话复用见[快照指南](skills/jev-browser/references/snapshot-refs.md)、[会话指南](skills/jev-browser/references/sessions-auth.md)。

### 预览与确认

先看计划，不执行动作：

```bash
jevb page act demo "搜索 jev" --dry-run --json
```

模型不够确定时会展示页面、目标、内容和是否提交。终端输入 `y` 执行，其他输入取消；使用 `--json` 时，`needs_confirmation` 表示尚未执行。根据返回的确认编号，选择执行或取消：

```bash
jevb page act demo --confirm <确认编号>
jevb page act demo --cancel <确认编号>
```

确认编号限原会话使用，5 分钟内有效，只能处理一次。确认前会复核页面和目标；`--dry-run` 不生成可执行的确认编号。

`executed` 表示浏览器操作已完成，业务结果仍需检查页面。出现 `EXECUTION_UNKNOWN` 时先查看实际状态，避免重复提交；其他错误见[排错指南](skills/jev-browser/references/troubleshooting.md)。

### 指定动作和输入内容

```bash
jevb page act demo --op fill '姓名输入框' --value '张三'
printf '%s' "$TEST_PASSWORD" | jevb page act demo --op fill '密码输入框' --value-stdin
```

`--op fill` 清空后填写，`--op type` 追加，两者都不会自动回车。通过 `--value` 或标准输入提供的内容不发送给模型，也不回显。

## 4. 本地开发

需要 Node.js 22+ 和 Rust stable。在仓库根目录运行：

```bash
npm run dev
```

自动安装依赖、构建并将 `jevb` 和 `jev-browser` 链接到当前仓库，之后可在任意目录测试。修改源码后重跑此命令。

恢复正式版时，使用同一套 Node/npm 安装，会覆盖开发链接并保留源码：

```bash
npm install -g jev-browser-cli@latest
```

功能回归使用 `npm test`。连接专用测试浏览器后，可运行 `JEV_TEST_CDP=9222 npm run test:smoke`；真实模型测试使用 `test:live`，需配置 `OPENROUTER_API_KEY`。

打包或发布：

```bash
node scripts/licenses.mjs
npm pack
npm run publish -- --dry-run  # 预览发布
npm run publish              # 发布到 npm，需要发布权限
```

模型调用耗时、费用和测试覆盖见[验证记录](VALIDATION.md)。

## 5. 开源协议

采用 [Apache-2.0](LICENSE)。浏览器执行能力基于 [agent-browser](https://github.com/vercel-labs/agent-browser)，源码版本与授权见 [UPSTREAM.json](UPSTREAM.json)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
