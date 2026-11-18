# Changelog

## Unreleased

编辑器双栏、斜杠菜单与媒体粘贴稳定性
- 平板/桌面“更多”菜单增加可选独立双栏编辑；左右栏是各自可编辑、可滚动的宿主，列布局随笔记保存。默认书页式排版与窄屏手机单栏行为不变。
- 22 项斜杠命令适配独立列宿主；修复嵌套格式选区、反向选区和跨列焦点切换后的光标错位，并仅在确认命令 token 仍位于原块/原偏移时才移除它，避免误删正文或把 URL 中的斜杠当命令。
- 撤销/重做同步记录笔记内容、左右列布局和光标位置；恢复时按稳定块 ID 重新挂载 DOM，再还原列与编辑焦点。备份校验接受并校验独立列布局及其笔记块顺序。
- 音乐卡片粘贴区只接收音乐 URL 转卡片，普通文本继续可编辑；修复双栏下粘贴目标识别、原输入胶囊残留、原始 URL 重复和异步完成后重复卡片。粘贴加载态可从横向骨架过渡到方形卡片，普通加载比例不变，并尊重减少动态效果偏好。
- 细化独立列中的媒体卡片、加载骨架、长 URL 与窄栏排版；增加双栏布局往返、列内编辑/撤销重做及音乐粘贴的浏览器回归覆盖。
- 明确导出格式边界：Markdown 始终输出语义 Markdown；HTML/PDF 使用编辑器 DOM/CSS 快照，PDF 通过浏览器打印生成。

## 2.2.7

编辑体验、Markdown、响应式布局与导出细节
- 长标题编辑采用短标题向长标题单向升级布局，合并选区与视口变化后的光标同步；修复移动 Safari 折叠光标测量、输入跳动及每次输入都滚到末尾的问题。关闭编辑器时提交标题并立即保存草稿。
- Markdown 扩展处理前保护围栏代码、行内代码、HTML 标签和链接目标，避免代码示例、HTML 属性与 URL 被自定义语法误改；双链排除代码区，点击前保存当前笔记，再打开或创建目标笔记，并显示反向链接。
- 平板/桌面编辑器采用双栏书页布局，媒体卡片跨栏；窄屏手机横屏维持单栏。导出选择面板在短屏适配，统一沿用“更多”菜单的视觉样式。
- 微调既有导出入口与格式图标（去除方形底框），返回按钮统一为 46px 圆形控件；Markdown、HTML 与 PDF 继续共用实时编辑器 DOM/CSS 快照。
- 玻璃表面按主题、减少透明效果偏好和滤镜支持情况分层回退；保留键盘焦点和可读边界，不以外投影、高光或提亮装饰区分卡片。
- 停用 emoji 短码转换入口及低价值自定义标记；旧笔记原文保持不变，特殊分割线旧块仍兼容读取和导出。资源查询串和 Service Worker 缓存版本统一升级。
- 增加 Markdown 代码保护、双链导航、短屏导出面板、响应式编辑器与主题/毛玻璃视觉回归。

## 2.2.6

Markdown 扩展与离线资源
- 增加可折叠提示块与自定义标题、行内/块级数学公式、`[[笔记名]]` 双链、脚注、上标与下标。
- 将 KaTeX 运行时、样式和字体放入仓库，公式渲染不再依赖 CDN。
- Service Worker 首次安装预缓存应用入口、运行脚本、样式、KaTeX 字体和 ZIP Worker；Google Drive、天气与元数据仍是需联网的服务。
- 统一应用静态资源和 Service Worker 缓存版本。

## 2.2.5

响应式笔记看板与导出视觉一致性
- 手机横屏与平板首页采用三列 1:1 笔记卡，1280px 起的宽桌面增加为四列；手机竖屏保留原有胶囊列表，卡片圆角 26px。
- Markdown、HTML、PDF 共用编辑器实时 DOM/CSS 快照；Markdown 使用样式化 HTML 快照保留图文、链接、音乐、待办等卡片视觉。
- 增加 Mynote 专属视觉规范与导出/断点回归测试。
- 更新应用静态资源与 Service Worker 缓存版本。

## 2.2.4

导出视觉保留
- HTML/PDF 改为按原始块结构导出，保留图文卡片、横排图文、画廊、音乐/网页卡片元数据和附件
- 独立 HTML 内嵌图片与主题/打印样式；Markdown 图文块补回说明文字
- 更新应用静态资源与 Service Worker 缓存版本

## 2.2.3

编辑器导出
- 编辑页更多菜单增加统一导出入口，提供 Markdown、HTML 和 PDF 格式选择
- Markdown/HTML 作为文件下载；PDF 使用浏览器打印与存储流程
- 补齐格式浮层动画、点击态、键盘焦点和关闭交互

## 2.2.2

Markdown 阅读体验
- 编辑态和预览态共享正文、标题、行距与段间距尺度
- 按明暗主题细化链接、引用、提示块、代码和任务复选框颜色；提高辅助文字及提示图标对比度
- 减少引用、提示块和待办列表的胶囊卡片感
- 窄屏表格和代码块改为容器内横向滚动，链接与长代码可安全换行
- 增加链接、任务项的可见键盘焦点和更易触控的待办区域
- 待办编辑控件改用原生复选框，修正空格键切换、无障碍状态同步与保存
- 新增浅色/深色、360/390/1280px Chromium 视觉回归，并更新缓存版本

## 2.2.1

安全与数据完整
- 移除仓库内明文和风天气 key（部署时注入 `__APP_CONFIG__.QWEATHER_API_KEY`）
- `saveMemo` 先同步写 localStorage 再走 IDB；IDB 失败不再连带丢缓存
- Editor 挂 `pagehide` / `visibilitychange`，防抖窗口内关页不丢稿
- Drive 备份改 resumable 上传（multipart 官方限 5MB）
- IDB 首存不再 clear 全表，改为采纳当前 store 为 baseline
- 恢复提交后立即刷新 `_memoBaseline`，防旧状态写回

编辑器
- 封面加载失败改事件委托（DOMPurify 剥内联 onerror）
- 多音乐卡失焦串号（var 循环闭包）修复
- 前缀转换只替换命中块并恢复光标
- 背景色只传 delta，不再展开旧 memo
- 空段落 Backspace 不再连带删原子块
- 粘贴截图/图片作为附件插入
- 图片点击开 lightbox；非图片选入占位有提示
- 句中 `/cmd` 也会被剥掉
- 斜杠命令不再污染共享 defs
- ZIP Worker 不可用时降级主线程 fflate

编辑器重大缺陷修复（本轮真机排查发现）
- 首次应用斜杠命令后光标落在容器游离 div，后续 / 永远不再弹面板（即“串功能/误触”根因）：新增游离块自救 + 光标钉回块内 + 兜底新段落
- mdCheckTimerRef / blurApplyingRef 未定义即传入 hook，inline 类命令（斜体/高亮/彩色标签等）应用即抛错致面板永久失效
- 粘贴修复：文本夹普通链接也抽链接转卡（此前仅纯 URL / 白名单域名），剩余文本保留原位
- 新增 tests/browser/full-smoke.mjs：23 项全功能真机冒烟

清理
- 删除死代码 BlockSystem / LinkCard / restoreAttachmentsFromZip
- IP 定位换 HTTPS 可用的 ipapi.co
- 草稿 load 读 IDB 兼底；clear 同步删 IDB
- 合并云端时单个坏附件不再整体失败

结构与兼容
- editor.js 抽出 slash-model（纯过滤）、lifecycle-hooks（pagehide / 封面破图）、use-history（撤销/重做 + Cmd+Z / iOS 三指）、use-slash + slash-panel（斜杠状态/应用/面板 UI）、use-editor-dom（click/todo/blur/focus 管线）
- editor.js 3662 → 2287 行
- BackupView 拆出 services/zip.js（有界解压/流式打包）与 services/drive.js（Drive 列表/分片上传/解码），1299→1096 行
- storage.idb 拆出 services/backup-validate.js（手写 ZIP 校验 + 备份白名单，纯函数可测），860→677 行
- memo-list 拆出 app/demo-memos.js（demo 笔记 + 城市表），753→671 行
- 全仓去掉可选链 / ????，补 AbortSignal.timeout 与 Promise.allSettled 垫片
- 新增 Service Worker（同源 SWR，不碰跨域 API）
- Moment / index 加 CSP（登录 iframe 已放行 accounts.google.com）
- ZIP 打包改流式 fflate.Zip，主线程不再堆全量附件；manifest 改 cursor 只读 name/type
- Chromium 冒烟：列表渲染 / 编辑输入 / 撤销重做 / 斜杠面板应用+Esc / SW 接管，0 pageerror

## 2.2.0

- 拆分 Moment.html：主运行时按桥接、Editor、天气、列表、启动拆为独立脚本
- 抽取全局设计令牌，CSS 与内联样式统一使用颜色、字号、圆角、阴影变量
- 启动页样式与倒计时脚本独立，移除页面内联 style/script
- 新增拆分结构、样式令牌与运行模块测试

## 2.0.2

编辑页返回首页的过渡顺滑了很多，闪烁明显减少
- Google 登录/退出后，首页头像自动同步，不用手动刷新
- 天气链路修好了（和风主用，彩云兜底）
- 启动页恐龙换成了 SVG，视觉更统一
- 备份页图标、Toast 显示细节修复
- 浅色背景改成 iOS 系统灰 `#f2f2f7`，看着更舒服
