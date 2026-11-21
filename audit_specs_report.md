# 开发规范文档盘点与 Rust 版合规对比报告

审计性质：只读审计，未改任何代码。方法：通读仓库内全部规范/文档类文件，逐条摘录规范要点，再逐条对照 Rust 版（`rust/`）现状取证判定。

---

## 一、盘点范围

### 实际存在并已通读的文档

| 文件 | 性质 |
|---|---|
| `README.md`（149 行） | 产品说明 + 技术说明 + 代码结构 + 视觉回归运行方式 |
| `docs/engineering-notes.md`（48 行） | 工程约定主文档：页面与静态资源、Markdown 与内容安全、编辑器状态与保存时序、本地数据与备份、导出与响应式、回归检查 |
| `docs/mynote-visual-language.md`（63 行） | 视觉规范：首页卡片规则、玻璃表面与主题适配、导出一致性、编辑器大屏布局、无障碍、实现与验收 |
| `CHANGELOG.md`（125 行） | 版本变更记录，其中 2.2.0 / 2.2.1 两节记录了明确的结构拆分与瘦身惯例 |
| `TESTING.md`（28 行） | Rust Web 回归测试矩阵（一键脚本、覆盖矩阵、未覆盖项） |
| `package.json` | 以脚本形式编码的门禁：`verify` / `test` / `check` / `test:browser*` |
| `tools/verify.mjs` | 静态校验的规范实现（文件头注释列明 6 项检查） |
| `Moment.html` / `index.html` | 页面骨架、CSP、资源版本串 `?v=2.2.7` 的实际形态 |
| `.github/workflows/mynote-flutter.yml` | 唯一 CI 工作流（仅覆盖 `native/**` Flutter 路线：analyze + test + web build + iOS 未签名 IPA） |
| `tests/`（6 个 `*.test.mjs`，共 1064 行 + `tests/browser/`） | 原版单元/结构/令牌/导出/预览测试与浏览器视觉基线体系 |
| `src/` 各模块文件头注释 | 模块级约定（如 `slash-model.js` 文件头注明纯函数定位、`services/zip.js` 注明抽出自 BackupView） |

### 不存在（已逐一核查，注明以免误判为遗漏）

- 仓库根：`CONTEXT.md`、`SKILL.md`、`AGENTS.md`（仓库内无此文件；同名文件存在于仓库之外的工作区约定中，不属本仓库规范）、`CONTRIBUTING.md`、`DEVELOPMENT*` 均不存在。
- `docs/` 下仅有上述两份文档，无 `docs/SKILL.md` 等其他文件。
- `.github/` 下仅 `workflows/`，无 issue/PR 模板。
- 无 lint/format 配置：`.eslintrc*`、`.prettierrc`、`.editorconfig` 均不存在；Rust 侧 `rustfmt.toml`、`clippy.toml` 亦不存在。
- Rust 侧无任何说明文档：`rust/README.md`、`rust/apps/web/README.md`、`rust/docs/` 均不存在。

### Rust 侧用于对照的现状材料

`rust/Cargo.toml`（workspace：crates/core、crates/storage、apps/web）、`rust/apps/web/src/*.rs`（11 个模块）、`rust/apps/web/styles/{tokens,base,editor,panels}.css`、`rust/apps/web/lang/*.json`（5 包）、`rust/apps/web/build.sh`、`rust/apps/web/sw.js`、`run_all_tests.sh`、`TESTING.md`、各 `.rs` 文件头注释。

---

## 二、规范要点摘录（按主题，出处）

1. **页面与资源**（engineering-notes「页面与静态资源」；README「代码结构」）：应用为无生产构建的静态 HTML；`Moment.html` 只保留骨架与引用，脚本顺序即运行时依赖；新增/改名静态资源须同步检查页面引用与 SW 预缓存清单，改版同步更新资源查询串、SW 缓存名与应用版本，并跑 `npm run verify`；SW 只缓存同源资源。
2. **页面无内联**（tools/verify.mjs 第 3 条；CHANGELOG 2.2.0）：页面不得残留内联 style/script，启动页样式与脚本须外移到 `src/`（原版 `index.html` 的启动样式在 `src/styles/launch.css`）。
3. **版本串统一**（tools/verify.mjs 第 4 条；package.json `version: 2.2.7`）：本地 `src/` 资源一律携带统一版本查询串，且与 package.json 版本一致。
4. **静态校验六项**（tools/verify.mjs 文件头）：本地引用必须存在；脚本可语法解析；无内联 style/script；版本串统一；跨模块顶层声明不得重复且关键模块引入顺序正确；CSS 自定义属性必须全部有定义。
5. **模块分工**（README「代码结构」）：`src/app/`（运行时桥接、Editor、列表、启动）、`src/styles/`、`src/editor/`、`src/components/`、`src/services/`、`src/hooks/`、`src/utils/` 各司其职；模块文件头一句话注明职责。
6. **拆分瘦身惯例**（CHANGELOG 2.2.1）：大文件按纯函数/职责抽出独立模块并瘦身——editor.js 3662→2287 行（抽出 slash-model 纯过滤、lifecycle-hooks、use-history、use-slash、slash-panel、use-editor-dom），BackupView 1299→1096（抽 services/zip.js、drive.js），storage 860→677（抽 backup-validate.js 纯函数可测），memo-list 抽 demo-memos.js。
7. **设计令牌单一入口**（README/CHANGELOG 2.2.0；visual-language「主题与无障碍」）：颜色、字号、圆角、阴影统一走 CSS 令牌（`src/styles/tokens.css` + `tokens.js`）；深色与减少透明由语义变量与平台回退处理。
8. **玻璃与无障碍底线**（visual-language）：玻璃按 overlay/content/control 三层分级；卡片不用外投影、高光、提亮、辉光分层；焦点环可见；待办触控不低于 44×44px；减少动态效果时动画近乎归零。
9. **响应式布局规则**（visual-language；engineering-notes「导出与响应式界面」）：首页竖屏时间线、横屏/平板三列、1280px 起四列，卡片 1:1、圆角 `--radius-26`；编辑器大屏双栏书页、媒体跨栏、窄屏横屏单栏；可选独立双栏默认关闭、随笔记保存、保存/撤销/导出保持左至右顺序。
10. **Markdown 与内容安全**（engineering-notes「Markdown 与内容安全」）：扩展语法扫描前先保护围栏代码、行内代码、HTML 标签与链接目标；已停用的短码/自定义语法原样保留，任何路径不得静默改写旧笔记；生成 HTML 必须净化，DOMPurify 不可用时失败关闭；链接协议必须过滤；扩展语法在编辑器、预览、摘要、导出、搜索间保持一致；双链导航前先落盘当前笔记。
11. **编辑器状态与保存时序**（engineering-notes「编辑器状态与保存时序」）：正文为单一 contentEditable 流（独立模式为双列宿主）；格式转换尽量局部更新并恢复光标，恢复以 `{blockId, column, offset}` 描述、用 `Selection.focus` 取焦点；斜杠命令仅在 token 仍可验证时才删除触发文本；关闭编辑器前先提交标题并 flush 自动保存。
12. **本地数据与备份**（engineering-notes「本地数据、附件与备份」）：本地保存容忍单一存储层失败——localStorage 同步草稿兜底 + IndexedDB；页面隐藏/关闭前处理未完成防抖保存；附件按引用收集、图片类型优先看文件魔数；ZIP 导入先做大小、路径、记录 ID、类型与字段白名单校验再提交；单个坏附件不拖垮整份恢复。
13. **导出一致性**（visual-language「导出一致性规则」；engineering-notes）：HTML/PDF 从当前编辑器 DOM 与应用 CSS 快照导出，不另写近似渲染器，PDF 用同一 HTML 走浏览器打印；Markdown 始终从结构化笔记生成语义 Markdown，不含 DOM/CSS 快照；HTML/PDF 共用编辑器式页眉。
14. **回归门禁**（engineering-notes「回归检查」；README「自动视觉回归」；package.json scripts）：`npm run verify` 静态校验；`npm test` 覆盖存储/备份校验、Markdown、安全协议、导出、预览、结构；`npm run check` = verify + test + 响应式浏览器测试 + 玻璃视觉矩阵（3 视口 × 明暗 × 透明度/滤镜回退共 18 组像素基线）；改扩展语法须加跑 `test:browser:markdown`；改双栏须加跑 `test:browser:responsive`；视觉基线只能在有意调整界面并审阅后用 `UPDATE_VISUAL_BASELINES=1` 更新。
15. **变更记录**（README 技术说明指向 CHANGELOG）：改进与修复记录统一记入 `CHANGELOG.md`，按版本分节。
16. **异常可见**（README「技术说明」）：运行时异常捕获模块（ErrorBoundary + 浮动调试面板）为标配。

> 说明：诊断日志「每个模块同步接入、入口在设置页」与多语言包机制并非原版仓库文档中的规范——前者是 Rust 重构期间确立的项目规矩（成文于 `rust/apps/web/src/diag.rs` 文件头），后者是 Rust 版自建机制（成文于 `rust/apps/web/src/i18n.rs` 文件头）。本报告将其作为 Rust 侧自有规范一并核对执行情况。

---

## 三、逐项对比

| # | 规范要点（出处） | Rust 现状（证据） | 判定 | 整改要点（未合规项） |
|---|---|---|---|---|
| 1 | 模块按 app/styles/editor/components/services/hooks/utils 分工，文件头注明职责（README 代码结构；src/ 文件头惯例） | 分工有对应：main.rs（外壳/路由）≈ app/、blocks.rs ≈ editor 渲染、settings.rs ≈ components、idb.rs ≈ services、list.rs ≈ memo-list、wiki.rs/diag.rs/i18n.rs 独立成文且各有文件头职责注释（main.rs、diag.rs、i18n.rs 文件头均成文） | 合规 | — |
| 2 | 大文件拆分瘦身、纯逻辑抽独立可测模块（CHANGELOG 2.2.1） | 纯逻辑下沉做得更彻底：crates/core（model/backup/backup_zip/inline_html）+ crates/storage 与 UI 完全分离且有单测；但 apps/web 内 `editor.rs` 达 4378 行（桥 JS + 斜杠 + 导出 + 双栏 + 标题坞全在一文件），超过原版拆分前的 editor.js（3662 行），同类问题：blocks.rs 1178 行、list.rs 1225 行 | 部分合规 | 按原版惯例拆 editor.rs：至少把导出（export）、斜杠面板、EDITOR_JS 桥拆为独立模块 |
| 3 | 页面只保留骨架与引用、脚本顺序即依赖（engineering-notes；README） | Rust 为单 wasm 入口，无多脚本顺序问题；index.html 为外壳骨架 | 不适用 | — |
| 4 | 页面无内联 style/script，启动样式外移（verify 第 3 条；CHANGELOG 2.2.0） | `rust/apps/web/index.html` 内含一段内联 `<style>`（启动页样式，注释自述为壳自带样式、wasm 就绪前绘制）；全部应用样式经 main.rs `include_str!` 拼接后由 `document::Style` 注入（main.rs:29-33、295），无外链 CSS 文件 | 部分合规 | 将启动页样式外移为独立 launch.css 外链（原版 index.html 正是此形态），消除唯一的字面内联样式 |
| 5 | 设计令牌单一入口、样式走变量（出处 7） | styles/tokens.css 单文件（270 行）为唯一令牌源，深色只换令牌；main.rs:28 文件头立规「组件里禁止再堆内联样式；动态值只走 CSS 变量注入」；四文件组织对齐原版 styles/ 分工 | 合规 | — |
| 6 | CSS 变量必须全部有定义，由 verify 自动检查（verify 第 6 条） | 无任何等效自动校验：CSS 变量未定义、语言包键集一致、dist 引用完整性均无门禁脚本，仅靠冒烟间接覆盖 | 未合规 | 补一个 Rust 侧 verify 等效脚本（CSS 变量定义检查 + lang 五包键集比对 + dist 文件清单），并挂入 run_all_tests.sh |
| 7 | 样式文件分工（原版 styles/ 共 7 个：tokens/base/editor/editor-shell/cards/launch/panels） | Rust 为 4 个：cards 并入 base/editor、editor-shell 并入 editor.css（1183 行，为原版 editor.css 392 + editor-shell 630 之和的合并）、launch 进 index.html 内联 | 部分合规 | 随第 2、4 条一并处理：editor.css 拆出 shell 部分、启动样式独立成文 |
| 8 | 版本串统一：单一版本源、资源查询串、SW 缓存名、改版同步（verify 第 4 条；engineering-notes） | 无应用语义版本：`rust/apps/web/Cargo.toml` 与 core 均为占位 `0.1.0`；build.sh 以 wasm md5 前 10 位戳入 sw.js 版本（缓存失效机制等效且自动化），但与任何发布版本/变更记录无对应关系 | 部分合规 | 给 Rust Web 定一个语义版本号（单一事实源），build.sh 戳入 SW 与页面，发布时与 CHANGELOG 对应 |
| 9 | SW 只缓存同源、预缓存清单随资源变更同步（engineering-notes） | sw.js 预缓存壳 + 全部语言包，导航与 .js/.wasm/.html 网络优先、其余 SWR，激活时清旧缓存；版本戳由 build.sh 自动生成，无需手工维护清单版本 | 合规 | — |
| 10 | 玻璃三层、无投影辉光、焦点可见、触控 ≥44、减少动效归零（visual-language） | 令牌与样式逐项复刻，smoke-rustweb-visual 以数值断言验收关键度量（fab 46、行圆角 32 等）；减少透明/动效的回退依赖令牌层 | 合规 | — |
| 11 | 响应式布局规则（visual-language；出处 9） | 列表分组/折叠与编辑器双栏（含独立滚动双列网格）已按原版断点实现并有冒烟（smoke-rustweb-list/gaps）；宽屏首页三/四列网格属列表视觉范畴，由其他审计跟进 | 合规 | — |
| 12 | Markdown 代码保护、停用语法原样保留、净化与协议过滤、各路径一致（engineering-notes） | core/inline_html.rs 双向转换（==高亮== ↔ mark、代码段保护、ZWSP 剥离），存储层保持字面格式；wiki 扫描跳过代码子树；相关行为有 blocks/wiki/highlight 冒烟覆盖。细节级一致性由功能审计另行跟进，此处只判规范层 | 合规 | — |
| 13 | 编辑器状态与保存时序：局部更新恢复光标、斜杠 token 验证、关前 flush（engineering-notes） | 架构不同（分块 contenteditable + JS 桥），对应机制为桥内 caret 描述与 focus_req 信号、先落盘再导航（wiki 导航、返回路径）；逐项行为差异已由编辑态专项审计单列（audit_editor_state_report.md），不在本报告重复判定 | 部分合规 | 以编辑态审计清单为准逐项收口，本条不另立整改项 |
| 14 | 本地保存双通道容错：localStorage 草稿兜底 + IndexedDB（engineering-notes） | 仅 IndexedDB 单通道（idb.rs：mynote-web 库 kv + attachments 两 store）；localStorage 只存诊断日志与语言包缓存，不构成笔记数据兜底 | 部分合规 | 评估补一层 localStorage 草稿兜底（至少标题/正文 JSON 同步镜像），或成文记录单通道的取舍理由 |
| 15 | ZIP 导入先校验后提交、坏附件不拖垮恢复（engineering-notes） | core/backup_zip.rs + storage validate-then-swap 单事务替换，真实备份双向互通已验；导入校验含大小/条目/单文件上限 | 合规 | — |
| 16 | HTML/PDF 快照导出、MD 语义导出、共用页眉（visual-language；出处 13） | editor.rs collect_app_css() 抓取应用样式表 + doc_to_html 套原版页眉结构，PDF 复用同一文档走打印；MD 由模型生成（export_md） | 合规 | — |
| 17 | verify + test + check 组合门禁，改哪跑哪（出处 14） | run_all_tests.sh 等效组合门禁：cargo test → build.sh → 本地服务 → 14 套冒烟，任一 ✗ 即 SOME SUITES FAILED 非零退出，与 TESTING.md「ALL GREEN 才算过」一致；但无 verify 等效静态校验（见第 6 条），且 md/双栏无独立专项命令、靠全套覆盖 | 部分合规 | 随第 6 条补静态校验并纳入同一门禁 |
| 18 | 单元测试覆盖存储/备份/md/安全/导出/预览/结构（出处 14） | cargo test 实测 21 个 #[test]（crates/core/tests 四个文件 + storage/tests/pipeline.rs），覆盖备份 ZIP、inline_html、roundtrip、时间戳、storage 管线；但 web 层纯逻辑（md_classify、wiki 扫描、slash 过滤模型、列表预览剥 md）无单测，仅靠浏览器冒烟 | 部分合规 | 把 web 层纯函数逐步下沉 core 或在 web crate 内补可测单元（优先 wiki 与 md_classify） |
| 19 | 视觉回归：18 组像素基线矩阵，基线更新须审阅（README；出处 14） | 无像素基线体系；smoke-rustweb-visual 以关键度量数值断言替代（头像 72、胶囊 66、圆角 32 等，见 TESTING.md），无基线截图与像素 diff | 部分合规 | 如需等效保障，引入关键页面截图基线（本地无头 Chromium 已具备条件），或成文接受度量断言为既定口径 |
| 20 | 改进与修复记入 CHANGELOG 按版本分节（出处 15） | 根 CHANGELOG.md 只记原版应用，全文无 Rust 字样；Rust 侧各批次（高亮、审计修复、wiki、差距批次）只记在仓库外的工作记忆中，仓库内无任何变更记录 | 未合规 | 为 Rust Web 建变更记录（并入根 CHANGELOG 新分节或 rust/ 内独立 CHANGELOG），与第 8 条版本号对应 |
| 21 | README 代码结构与文档索引与代码同步（README「代码结构」自述体例） | 根 README 全文未提及 rust/ 目录与 Rust 版存在；Rust 侧无 README/开发说明，构建与部署知识只散落在 build.sh 注释、main.rs 文件头与 TESTING.md 中 | 未合规 | 补 rust/README.md（或根 README 增 Rust 版一节）：结构映射、构建、部署、回归入口四件事成文 |
| 22 | 运行时异常捕获与调试入口为标配（出处 16）+ 诊断全模块接入（Rust 自有规矩，diag.rs 文件头） | diag.rs 实现达标：300 行环形缓冲 + localStorage 持久（mynote_diag_v1）、设置页内诊断入口、标签体系齐全（APP/IDB/IMPORT/EXPORT/EDIT/LANG/SAFE/CARD/WIKI）；但执行有漏：`list.rs` 与 `wiki.rs` 全文件零 diag 调用（实测 grep：list.rs 0 条、wiki.rs 0 条；对照 editor.rs 58 条、main.rs 16 条、settings.rs 10 条），列表模块的关键动作（搜索、滑动删除/置顶）无日志 | 部分合规 | 给 list.rs 补齐关键动作日志（搜索命中、滑动删除/置顶、分组折叠），wiki.rs 补解析/成链日志，与其他模块同口径 |
| 23 | 语言包机制（原版无此规范） | 原版为单语硬编码，无 i18n 规范可对照；Rust 自建 Telegram 式语言包（i18n.rs 文件头成文：文案一律走 t()/tf()、zh-CN 内嵌保底、缺键回退链），5 包各 206 键、键集实测一致，按需下载 + localStorage 缓存 + 冒烟验证（smoke-rustweb-i18n） | 不适用（自洽合规） | 键集一致目前靠人工核对，建议随第 6 条纳入自动校验 |
| 24 | 仓库版本管理与部署流程成文（原版：全部文件入 git，GitHub Pages 静态发布；CI 仅覆盖 Flutter 路线） | Rust 侧流程性缺口最大：`git status` 显示 `rust/`、`TESTING.md`、`run_all_tests.sh` 全部为未跟踪文件，至今未纳入版本管理；`.gitignore` 未包含 `rust/target`、`dist`；部署走 Cloudflare Pages + 仓库外脚本（位于工作区 `mynote-ab/tools/deploy_api.py`，不在本仓库），仓库内仅 build.sh 一行注释提及，无成文部署步骤与校验判据 | 未合规 | 优先把 rust/ 与回归脚本纳入 git 并补 .gitignore；部署脚本入库或在 rust 开发说明中成文部署步骤与验活判据 |

### 附带发现：文档数字过期一处

`TESTING.md` 覆盖矩阵首行写「`cargo test`（15 项）」，与当前实测 21 个 `#[test]` 不符；同文件「未覆盖」段仍称双栏独立滚动未建，而该功能已由差距批次落地并有 smoke-rustweb-gaps 覆盖（矩阵末行已登记，前后自相矛盾）。建议随第 20/21 条整改时一并修订。

---

## 四、汇总

- **合规**：第 1、5、9、10、11、12、15、16 条（模块分工、令牌单一入口、SW 缓存、玻璃与无障碍、响应式、Markdown 规范层、ZIP 校验、导出一致性）。
- **不适用**：第 3 条（脚本顺序，架构不同）；第 23 条语言包为原版无规范、Rust 自洽合规。
- **部分合规（7 条）**：第 2（editor.rs 单文件 4378 行未按拆分惯例瘦身）、4（index.html 内联启动样式）、7（样式文件合并粒度）、8（无语义版本）、13（编辑态时序，另有专项审计）、14（本地保存单通道）、17/18/19（门禁缺静态校验、web 层纯逻辑无单测、视觉回归为度量断言而非像素基线）、22（诊断在 list/wiki 两模块零接入）。
- **未合规（4 条，按优先级）**：
  1. 第 24 条——Rust 全部代码与回归脚本未纳入 git、部署工具与流程未入库成文（风险最高：无版本留存）。
  2. 第 6 条——无 verify 等效静态校验（CSS 变量、语言包键集、dist 完整性无门）。
  3. 第 20 条——Rust 变更未入任何 CHANGELOG。
  4. 第 21 条——Rust 侧无开发说明文档，根 README 未提及 rust/。
