<p align="center">
  <a href="https://overtrees.github.io/Mynote"><img src="./Mynoteicon.png" width="80" alt="此刻"></a>
</p>

<p align="center">
  <strong>此刻</strong>
</p>

<p align="center">
  <a href="https://github.com/Overtrees/Mynote/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://overtrees.github.io/Mynote"><img src="https://img.shields.io/badge/App-%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-brightgreen" alt="App"></a>
  <a href="https://github.com/Overtrees/Mynote/commits/main"><img src="https://img.shields.io/github/last-commit/Overtrees/Mynote" alt="Last Commit"></a>
</p>

有时候你只是想记一句话、存一张图、贴一个链接。  
不想先建目录，不想被一堆按钮打断，也不想为了记点东西先登录账号。  
「此刻」就是为这种场景做的：无需选择模版，打开就写，数据归你。

音乐链接贴进去自动变卡片、标题点一下就能改、顶部渐变随背景色自适应——这些细节你可能用着用着才会发现。

## 这个 App 想解决什么问题

不是做一个"最强笔记系统"，而是做一个你愿意每天顺手打开的记录工具。

你会在这些时刻用到它：

- 🚇 地铁上突然想到一个点子，想马上记下
- 🎵 刷到一首歌，想留个卡片以后再听
- 📋 记会议要点、待办、灵感碎片，不想切来切去
- ✨ 对日常碎片化记录，想做个好看的排版

---

## 日常会用到的功能

### 📝 记
- 段落、标题、待办、引用、分割线、代码块、Callout 提示块
- 图文卡片、图片卡片、文件附件（图片自动渲染，PDF/Word 等文件支持点击系统分享）、音乐卡片（粘贴链接 / 斜杠命令插入，通过 Cloudflare Worker 抓取元数据，部分地区可能受限）
- 标题胶囊：滚动自适应横竖排，点一下就能改
- 斜杠命令面板：22 种排版命令，支持搜索筛选和最近使用
- Markdown 自动渲染（**粗体**、*斜体*、~~删除线~~、`行内代码`；应用内额外支持 ==高亮==、提示块、数学公式、双链、脚注、上标与下标）
- 单篇笔记可从“更多 → 导出”选择 Markdown、HTML 或 PDF；导出会尽量沿用编辑器当前的卡片结构与样式

```md
> [!TIP]- 自定义标题
> 这里是可折叠的 **提示正文**。

行内公式 $x^2 + y^2 = z^2$，双链 [[另一篇笔记|自定义文字]]，脚注[^来源]，上标 ^(高1)^、下标 ~(低1)~。

$$
\frac{1}{2}
$$

[^来源]: 这里是脚注正文。
```

`> [!TIP]+ 标题` 会默认展开，`-` 会默认折叠。旧笔记里的 `:smile:` 等 emoji 短码，以及已停用的自定义标记（如 `!!提示`、`#标签`、`$标签$`、`->居中<-`），都会按原文显示，不会被转换或改写。

### 👀 看
- 首页按时间分组，信息一眼就能找到
- 手机竖屏保留时间线列表；手机横屏与平板使用三列方卡，宽桌面（1280px 起）使用四列
- 支持置顶、展开/收起长分组
- 图文卡片自动识别文件类型，图片显示原图，非图片文件可点击打开
- 平板和桌面编辑器采用双栏书页布局，媒体卡片跨栏显示；较窄的手机横屏仍保持单栏
- 从编辑页返回时，首页从右侧跟随滑入，过渡自然

### 💾 存
- 默认本地保存（IndexedDB + localStorage 双通道）
- Google Drive 云备份 / 云端恢复（连接 Drive 后合并云端与本地数据）
- ZIP 导出/导入（含所有图片和附件）
- 本地记录、单篇导出和 ZIP 备份无需注册登录；使用 Google Drive 云备份或恢复时才需要连接 Google 账号

### 🎨 调
- 字号切换
- 笔记背景色（8 色可选，顶部渐变自适应背景色）
- 头像（含 Google 头像自动同步）
- 毛玻璃样式按明暗主题、透明度偏好和浏览器能力回退，并保留可读边界

---

## 和常见笔记工具不一样的地方

| | 其他笔记 | 此刻 |
|---|---|---|
| **组织体系** | 文件夹 / 标签树 / 数据库 | 打开就写，时间流 |
| **账号** | 强制注册登录 | 本地记录无需登录，云备份/恢复需连接 Google Drive |
| **数据** | 默认存服务端 | 默认存本地，可选择云备份 |
| **外观** | 功能优先 | iOS 原生感（毛玻璃、过渡、圆角） |

---

## 界面预览

<details>
<summary>点击展开截图</summary>

### 首页
![首页列表](./screenshots/list-view.jpg)

### 编辑页
![编辑页面](./screenshots/editor-view.jpg)

### 设置页
![设置页面](./screenshots/settings-view.jpg)

### 备份页
![备份页面](./screenshots/backup-view.jpg)

### 音乐卡片
![音乐卡片](./screenshots/music-card.jpg)

</details>

---

## 隐私

- 默认笔记和附件保存在本机 IndexedDB；导出的 ZIP 与 Drive 备份目前没有客户端加密。
- 天气功能会自动请求浏览器定位；定位不可用时会尝试 IP 定位，并把坐标发送给和风天气查询天气与城市。此功能需要网络与部署时提供的 API 配置。
- 链接元数据和图片代理请求会把目标 URL 发送到 `mynote.overtrees.workers.dev`；Worker 实现不在本仓库中，无法从此仓库确认其日志、转发或保留策略。
- 只有你主动连接 Google Drive 并备份时，笔记/附件才上传到你自己的 Drive appData；Google OAuth token 仅保存在当前页面内存中，不写入本地存储。
- Google 头像 URL 可能保存在本机；浏览器本身也会向天气、Google、和风天气和 Worker 等服务发送必要请求。

---

## 技术说明

- React 18（UMD）
- IndexedDB + localStorage
- Cloudflare Worker（链接抓取）
- 运行时异常捕获模块（ErrorBoundary + 浮动调试面板）
- Markdown 渲染、KaTeX 数学公式、字体和其他静态脚本/样式均使用仓库内资源，不依赖运行时 CDN；Service Worker 会预缓存这些本地资源，支持首次缓存完成后的离线编辑。
- Google Drive/登录、天气查询和链接元数据是联网服务，不会被伪装成本地资源；断网时这些在线功能不可用，本地笔记编辑与存储仍可用。

### 代码结构

- `Moment.html`：只保留页面骨架、样式与脚本引用
- `src/app/`：运行时桥接、Editor、列表、天气、启动等应用模块
- `src/styles/`：全局设计令牌、基础样式、编辑器/卡片/面板样式
- `src/editor/`、`src/components/`、`src/services/`：可复用编辑器、组件与存储能力
- `tools/verify.mjs`：校验本地资源、版本串、跨模块声明与 CSS 变量完整性
- 改进与修复记录见 [`CHANGELOG.md`](./CHANGELOG.md)；工程约定见 [`docs/engineering-notes.md`](./docs/engineering-notes.md)，视觉规范见 [`docs/mynote-visual-language.md`](./docs/mynote-visual-language.md)

### 自动视觉回归

`npm run check` 会运行静态校验、单元测试和 Chromium 截图回归。视觉矩阵覆盖手机、平板、桌面三种视口，浅色/深色主题，以及默认透明度、减少透明度偏好和无 `backdrop-filter` 回退（共 18 组）。运行前需有 Chromium 可执行文件（默认路径为 `/usr/bin/chromium`）。

单独运行可使用 `npm run test:browser:visual`。只有在有意调整界面并审阅结果后，才使用 `UPDATE_VISUAL_BASELINES=1 npm run test:browser:visual` 更新 `tests/browser/visual-baselines/` 中的基线；默认运行会与基线做像素比较。需要时可通过 `CHROME=/path/to/chromium` 指定浏览器。
