# Mynote Rust Web 版 · 安全区动态适配专项审计报告

- 审计时间：2026-11-21
- 审计性质：只读审计（未改任何应用代码）
- 用户红线：安全区必须动态适配——一律用运行时 `env(safe-area-inset-*)` 与视口单位按设备实时取值，禁止写死某台机器的数值。
- 审计对象：
  - Rust 版：`rust/apps/web/index.html`、`rust/apps/web/styles/{tokens,base,editor,panels}.css`、`rust/apps/web/src/*.rs`（含内联样式与 JS 桥字符串）
  - 原版对照：`src/styles/*.css`、`src/app/**/*.js`、`src/components/*.js`、`src/error-boundary.js`、`Moment.html`、`index.html`
- 计数口径：按「行」计。原版全树 `safe-area-inset` 共 **34 行**（CSS 12 行 + JS 22 行）；Rust 版共 **22 行**（CSS 20 行 + index.html 1 行 + main.rs 探针 1 行，该行含四边 inset）。

---

## 结论总览

| 分级 | 条数 | 要点 |
|---|---|---|
| 根因级缺陷 | **0** | `viewport-fit=cover` 已具备（见 §1.1），不存在「env() 恒为 0」的文档头根因 |
| 一般缺陷 | **3** | theme-color 缺失；manifest/apple-touch-icon 缺失；备份确认弹窗内层少一截 env 底距 |
| 提示级差异 | **4** | 状态 toast 底距常量 26≠原版 16；导出面板 maxHeight 与原版差 67px 扣减；菜单 CSS 规则重复一条；SlashPanel 视口兜底值 (393, 852) |
| 已对齐 | **原版 30/34 行有等价实现** | 其余 4 行属不适用（error-boundary 悬浮徽章 ×2、导出 HTML 头部 ×1、备份页内容底距经 .page-content 等价承接 ×1，详见 §3） |
| 写死机型数值 | **0 处** | 全树未发现 47px/34px 类安全区常量、未发现以固定视口高度（852/735/695）参与布局的写法 |

**一句话结论**：Rust 版的安全区体系是「原版 CSS 逐字移植 + env() 全程动态取值」，没有把任何一台机器的读数写死进布局；剩余问题集中在文档头配套（theme-color / manifest）与两处轻微数值口径差。

---

## §1 文档头（根因级检查）

### 1.1 viewport-fit —— ✅ 已对齐（无根因缺陷）

- Rust：`rust/apps/web/index.html:5`
  `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>`
- 原版：`Moment.html:6`、`index.html:5` 均含 `viewport-fit=cover`。
- 佐证（WebKit 官方博客《Designing Websites for iPhone X》，webkit.org/blog/7929）：`viewport-fit` 默认值为 `auto`，此时 Safari 把页面内容自动 inset 进安全区、页面不铺满全屏；设为 `cover` 后页面按全屏布局，`env(safe-area-inset-*)` 才给出设备真实的四边 inset 值。Rust 版已满足这一前提，**「env() 在 iOS 上恒为 0」不成立为本项目的缺陷**。
- 构建产物一致性：`build.sh:12` 为 `cp index.html dist/index.html`，审计时 `diff` 源与 `dist/index.html` 结果相同，线上即此文件。

### 1.2 theme-color —— ⚠️ 一般缺陷（缺失）

- 原版：`Moment.html:7-8` 与 `index.html:17-18` 均有双色：
  `<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">` / `content="#000000" media="(prefers-color-scheme: dark)">`
- Rust：`rust/apps/web/index.html` 全文无 `theme-color`。
- 影响：浏览器/系统 UI（状态栏区域底色、PWA 窗口边框色）无法跟随页面深浅色，安全区外侧的系统填充色与页面背景可能不一致——这正是「背景延伸到安全区」体验的一环（原版编辑页另有 html/body 背景延伸逻辑，Rust 已在 editor.rs 背景系统移植，不在此列）。
- 修复建议：在 `index.html` 头部补与原版同值的两条 theme-color（浅 #ffffff / 深 #000000，带 media）。

### 1.3 manifest 与图标 —— ⚠️ 一般缺陷（缺失，standalone 相关）

- 原版：`Moment.html:11-13` 有 `<link rel="icon">`、`<link rel="apple-touch-icon">`、`<link rel="manifest" href="manifest.json">`；`manifest.json:8` 有 `theme_color`。
- Rust：`index.html` 三者皆无。
- 影响：添加到主屏幕后的 standalone 启动缺少图标/主题色定义；standalone 与标签页模式的安全区/视口行为差异（项目既有实测：standalone 下 WebKit 只给文档滚动页全高视口）需要靠 manifest 正确声明 display 模式来稳定复现。
- 修复建议：补一份与原版同口径的 manifest（name/short_name/icons/theme_color/background_color/display）并在 index.html 链接，图标文件随 dist 一起发布。

### 1.4 其余头字段 —— ✅ 已对齐

- `apple-mobile-web-app-capable`、`mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style=black-translucent`：Rust `index.html:6-8` 与原版 `Moment.html:9-10` 一致（black-translucent 是内容延伸到状态栏后方的前提，与 env(top) 公式配套）。

---

## §2 Rust 版 env() 用点全表（逐项判定）

### 2.1 styles/tokens.css

| 行 | 内容 | 判定 |
|---|---|---|
| 173 | `--safe-bottom: env(safe-area-inset-bottom);` | ✅ 与原版 tokens.css:173 同行同值；被 editor.css:522/524 引用（图文底表），与原版 editor-shell.css:119/121 用法一致 |

### 2.2 styles/base.css（与原版 base.css 逐行同构）

| 行 | 内容 | 原版对应 | 判定 |
|---|---|---|---|
| 13 | `body { padding-bottom: env(safe-area-inset-bottom) }` | base.css:13 | ✅ |
| 17 | `@supports (padding: env(safe-area-inset-top))` | base.css:17 | ✅ |
| 22 | `body::before { height: calc(env(safe-area-inset-top) * 1.2) }` | base.css:22 | ✅（顶部渐变带高度随 inset 动态） |
| 45 | `header { padding-top: env(safe-area-inset-top) }` | base.css:45 | ✅ |
| 95 | `top: calc(env(safe-area-inset-top) + 7px)` | base.css:95 | ✅ |
| 117 | `padding: 46px 16px calc(20px + env(safe-area-inset-bottom))` | base.css:117 | ✅ |
| 554 | `.status-toast { bottom: calc(env(safe-area-inset-bottom) + 26px) }` | 无直接对应（原版备份页 toast 为 BackupView.js:1048，`env + 16px`） | 🔶 提示：env 动态 ✓，但常量 26 与原版 16 不一致，且形态（居中胶囊 vs 原版左右 16 通栏）为 Rust 自有脚手架（文件内注释已自明「原版没有的运行时必需项」）。建议常量改 16 与原版统一口径 |

### 2.3 styles/panels.css

| 行 | 内容 | 原版对应 | 判定 |
|---|---|---|---|
| 185 | `.page-content { padding: 126px 20px calc(40px + env(safe-area-inset-bottom)) }` | SettingsView.js:42 同值；BackupView.js:530 底距同值（126/20/40+env） | ✅ 设置页与备份页共用此容器（settings.rs:86、207 均用 .page-content），原版两处底距在此一处承接 |
| 205 | `.backup-modal-scrim { padding: 0 14px calc(env(safe-area-inset-bottom) + 14px) }` | BackupView.js:805/867/926 外层 `bottom: calc(env + 14px)` | ✅ 弹窗底边距动态等价 |
| 206 | `.backup-modal { padding: 14px }` | BackupView.js:822/884/943 内层卡 `padding: 14px 14px calc(14px + env(safe-area-inset-bottom))` | ⚠️ 一般缺陷（轻微）：原版是「外层底边 env+14 + 内层底 padding 14+env」双层；Rust 只有外层 env，内层为平值 14px。弹窗底边位置一致，但卡内按钮距卡底少 env 一截（有小白条的设备上约少 34px 呼吸距）。建议：.backup-modal 改 `padding: 14px 14px calc(14px + env(safe-area-inset-bottom))` 与原版逐字对齐 |

### 2.4 styles/editor.css

| 行 | 内容 | 原版对应 | 判定 |
|---|---|---|---|
| 258 / 262 | `.editor-fab` 系 `top: calc(env(safe-area-inset-top) + 7px)` | editor.css:258/262（原版 styles/editor.css 同行） | ✅ |
| 522 | `.image-text-sheet-wrap { bottom: calc(var(--safe-bottom) + 14px) }` | editor-shell.css:119 | ✅ |
| 524 | `.image-text-sheet { padding: 20px 20px calc(20px + var(--safe-bottom)) }` | editor-shell.css:121 | ✅ |
| 937 / 939 | `height/max-height: max(200px, calc(100dvh - 187px - env(top) - env(bottom)))` | editor-shell.css:534/536 | ✅（187px 为组件结构常量，非安全区数值；视口用 100dvh 动态单位） |
| 1037 | `.detail { min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom) }` | editor.js:2472 根节点 `paddingBottom: env(...)` | ✅ |
| 1038 | `.editor-pad { padding: calc(env(safe-area-inset-top) + 155px) 16px calc(env(safe-area-inset-bottom) + 32px) }` | editor.js:3245/3246（155 = 7+66+4+66+12 结构和；底 32+env） | ✅ |
| 1041 | `.editor-title-dock { top: calc(env(safe-area-inset-top) + 7px); left/right: 62px }` | editor.js:2516 | ✅（62px 为坞的左右结构边距，与原版同值，非安全区写死） |
| 1063 | `.editor-menu-panel { top: calc(env(safe-area-inset-top) + 59px); … }` | editor.js:2787 为 `env + 7px + 46px + 6px`（=59） | 🔶 提示：数值等价，但与 1065 行规则重复定义同一选择器，1063 被 1065 覆盖。建议删 1063 行残留规则，避免后续改一处漏一处 |
| 1065 | `.editor-menu-panel, .editor-export-panel { top: calc(env + 7px + 46px + 6px); max-height: calc(100dvh - env(top) - 64px) }` | editor.js:2787/2796（菜单）；editor.js:3175/3178（导出面板 maxHeight 为 `100dvh - env - 7 - 46 - 6 - 8`） | 🔶 提示：菜单 ✅；导出面板与菜单共用同一 maxHeight，原版导出面板多扣 67px，面板较高时底部可能溢出略多。建议给 .editor-export-panel 单独一条 maxHeight 按原版 3178 公式 |
| 1095 | `.sheet-wrap { bottom: calc(env(safe-area-inset-bottom) + 14px) }` | BgSheet.js:24 | ✅ |
| 1097 | `.bg-sheet { padding: 20px 20px calc(20px + env(safe-area-inset-bottom)) }` | BgSheet.js:25 | ✅ |

### 2.5 index.html 外壳

| 行 | 内容 | 判定 |
|---|---|---|
| 15 | `.splash { height: 100vh; padding-bottom: env(safe-area-inset-bottom) }` | ✅ 对原版 launch.css:18/20（100vh + env 底距）；注：100vh 与原版同口径，非 Rust 独有写死 |

### 2.6 src/*.rs（JS 桥与内联）

| 位置 | 内容 | 判定 |
|---|---|---|
| main.rs:56 | SAFE 诊断探针：临时元素四边 `padding-*: env(safe-area-inset-*)`，读计算值写入诊断日志 | ✅ 动态读取的范本做法：每台设备运行时实测，不写死 |
| editor.rs（背景系统） | 顶部渐变 JS 读 `getComputedStyle(document.body).backgroundColor` + scrollY/30 alpha；html/body 背景由 effective_bg 写入 | ✅ 运行时动态，无安全区常量 |
| editor.rs:2927-2931 | SlashPanel 定位：`window.inner_width/inner_height` 运行时取值，`.unwrap_or(393.0)` / `.unwrap_or(852.0)`，且整体 `.unwrap_or((393.0, 852.0))` | 🔶 提示：393/852 仅为 web_sys API 失败时的兜底默认（正常路径永远走运行时读数），不构成机型写死；但兜底值恰好是某一机型尺寸，易被误读。建议兜底改 (0.0, 0.0) 或改读 visualViewport，消除歧义 |
| 其余 .rs | 全文检索 `bottom:`/`padding-bottom` 内联样式与 `47`/`34px`/`852`/`735` 等模式 | ✅ 无其他命中（icons.rs 的数字为 SVG 路径，list.rs 为文件魔数，均与布局无关） |

---

## §3 原版 env() 用点 → Rust 对应映射（34 行逐项）

### CSS（12 行）

| 原版 | Rust 对应 | 状态 |
|---|---|---|
| styles/tokens.css:173 `--safe-bottom` | tokens.css:173 | ✅ |
| styles/base.css:13 / 17 / 22 / 45 / 95 / 117 | base.css:13 / 17 / 22 / 45 / 95 / 117 | ✅ 逐行同构 |
| styles/editor.css:258 / 262 | editor.css:258 / 262 | ✅ |
| styles/launch.css:20 | index.html:15（外壳内联样式承接） | ✅ |
| styles/editor-shell.css:534 / 536 | editor.css:937 / 939 | ✅ |

### JS（22 行）

| 原版 | Rust 对应 | 状态 |
|---|---|---|
| editor.js:2472 根 `paddingBottom: env(bottom)` | editor.css:1037 `.detail` | ✅ |
| editor.js:2516 标题坞 top | editor.css:1041 | ✅ |
| editor.js:2787 / 2796 菜单 top / maxHeight | editor.css:1065 | ✅（1063 有重复残留，见 §2.4） |
| editor.js:3175 / 3178 导出面板 top / maxHeight | editor.css:1065（与菜单共用） | 🔶 maxHeight 差 67px 扣减，见 §2.4 |
| editor.js:3245 / 3246 正文 paddingTop/Bottom | editor.css:1038 | ✅ |
| editor.js（背景系统两段 effect）html/body 背景延伸 + body::before 渐变 | editor.rs 背景系统（effective_bg + __mnBgUpdate + use_drop 清理） | ✅ 机制等价移植 |
| SettingsView.js:42 内容 padding | panels.css:185 `.page-content` | ✅ |
| BackupView.js:530 内容底距 | panels.css:185（备份页同用 .page-content，settings.rs:207） | ✅ 等价承接 |
| BackupView.js:805 / 822（导出确认弹窗） | panels.css:205 / 206 | ⚠️ 内层少 env 底距，见 §2.3 |
| BackupView.js:867 / 884（导入确认弹窗） | 同上（共用 .backup-modal） | ⚠️ 同上 |
| BackupView.js:926 / 943（第三个确认弹窗） | 同上 | ⚠️ 同上 |
| BackupView.js:1048 状态 toast `bottom: env + 16px` | base.css:554 `.status-toast`（env + 26px） | 🔶 动态 ✓ 常量差 10px，见 §2.2 |
| BgSheet.js:24 / 25 | editor.css:1095 / 1097 | ✅ |
| export.js:454 导出头部 dock `top: env + 7px !important` | 无对应 | ➖ 不适用：该行是原版导出/打印渲染时对其页面头部的定位修正；Rust 版导出为文件下载（MD/HTML/PDF 走各自生成路径），不存在同一头部元素。若后续做「打印当前页」需再对 |
| error-boundary.js:98 / 106 错误徽章/面板 `bottom: calc(64px/108px + env(bottom, 0))` | 无对应 | ➖ 不适用：Rust 版无悬浮错误徽章组件（诊断在设置页内）。注：原版此处用了带兜底的 `env(..., 0)` 写法 |

### 横向 inset（left / right）

- 原版 CSS/JS **零用点**；Rust 版仅 SAFE 探针（main.rs:56）读取四边。无遗漏。✅

---

## §4 写死数值专项排查

检索模式：`47px`、`34px`、`852`、`735`、`695`、`789`、`896px`、`59px`、固定 `vh` 高度，覆盖 styles/*.css、index.html、src/*.rs。

- **安全区类写死：0 处。** 没有任何 `padding-top: 47px` / `bottom: 34px` 式机型常量；所有顶部/底部安全距均走 env() 或由 env() 派生的 `--safe-bottom` 变量。
- editor.css:600/1162 的 `clamp(34px, 4.8vw, 72px)` 是双栏阅读的列间距（column-gap），与原版 editor-shell 同值，非安全区。
- editor.css:1063 的 `59px` 是 `env(top) + 59px` 中的结构和（7+46+6），env 部分仍动态。
- 视口高度：布局用 `100dvh`（editor.css:937/939/1037/1065）与 `100vh`（base.css:14、index.html:15，后两者与原版 base.css:14、launch.css:18 同口径）；无固定像素视口高度参与布局。SlashPanel 的 852 兜底见 §2.6（提示级）。
- 结构常量澄清（易误判、实为原版同值）：标题坞 left/right 62px、菜单 top 的 +7/+46/+6、正文顶距 155px、底表 +14px 等，均为与安全区无关的组件结构尺寸，且与原版逐一同值——动态适配的要求针对 env() 部分，这些位置的 env() 部分均已动态。

---

## §5 平台前提佐证

1. **viewport-fit 是 env() 生效的前提**（WebKit 官方博客《Designing Websites for iPhone X》，2017，webkit.org/blog/7929/designing-websites-for-iphone-x/）：默认 `viewport-fit=auto` 时页面被自动 inset 进安全区；`viewport-fit=cover` 后页面全屏布局，`env(safe-area-inset-*)` 给出当前设备的真实 inset。Rust 版 index.html:5 已声明 cover，前提成立。
2. **env() 是运行时设备值**（同上文 + W3C《CSS Environment Variables Module Level 1》）：四边 inset 随设备、方向、显示模式（标签页/standalone）实时变化——这正是红线要求「动态适配」的实现路径，Rust 版全部用点均走此路径。
3. **项目实测注记**（非缺陷）：2026-11-20 探针 v3 已证 Safari 标签页模式下 env() 四边恒读 0；此时 Rust 版所有 env() 公式退化为与原版在同环境下完全相同的 0 值行为，两版表现一致；一旦在 env() 非 0 的环境（standalone / 内嵌 WebView）运行，同一套公式自动按设备取值——无需、也没有任何写死值介入。

---

## §6 修复建议汇总（按优先级）

| # | 级别 | 位置 | 建议 |
|---|---|---|---|
| 1 | 一般 | rust/apps/web/index.html 头部 | 补 theme-color 双色（#ffffff / #000000，带 prefers-color-scheme media），与原版 Moment.html:7-8 同值 |
| 2 | 一般 | rust/apps/web/index.html + dist 资产 | 补 manifest.json（display/theme_color/background_color/icons）与 apple-touch-icon、icon 链接，与原版 Moment.html:11-13 同口径 |
| 3 | 一般（轻微） | styles/panels.css:206 | `.backup-modal` padding 改为 `14px 14px calc(14px + env(safe-area-inset-bottom))`，补回原版内层 env 底距 |
| 4 | 提示 | styles/base.css:554 | `.status-toast` 底距常量 26px 改 16px，与原版 BackupView.js:1048 统一 |
| 5 | 提示 | styles/editor.css:1065 | 为 `.editor-export-panel` 单列 maxHeight：`calc(100dvh - env(safe-area-inset-top) - 7px - 46px - 6px - 8px)`（原版 editor.js:3178） |
| 6 | 提示 | styles/editor.css:1063 | 删除被 1065 覆盖的重复菜单规则，防双处维护 |
| 7 | 提示 | src/editor.rs:2927-2931 | SlashPanel 视口兜底 (393.0, 852.0) 改 (0.0, 0.0) 或 visualViewport 读数，消除「机型尺寸兜底」的歧义 |

（本报告只审计与建议，未改动任何代码。）
