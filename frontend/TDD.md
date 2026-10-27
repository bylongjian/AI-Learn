# 前端测试记录

## 2026-10-26 微信生产产物启动：RAF provider 自引用

官方 IDE 的最终生产产物只有背景，SDK `getApp()` 为 undefined。先只读运行真实 `dist/weapp` 的 Node VM 启动探针，复现 App 注册前 `ReferenceError: Cannot access 'c' before initialization`：入口 module4502 → Taro window module7860 → RAF module3363 → runtime 总出口 module4490 → 尚未初始化的 RAF const。数字 ID 仅用于当次定位，回归测试不依赖这些 ID。

当前 MiniWebpackPlugin 将自由变量 `requestAnimationFrame` / `cancelAnimationFrame` 注入为 runtime 导出，runtime 自身 RAF 实现也被注入，形成循环。只在内存中移除两次自读取，相同产物即成功注册 App，说明无需改登录或报告业务。随后将真实入口、首页注册、RAF 定时器和取消检查落为 `tests/weapp-startup-smoke.cjs`；先执行 `node tests/weapp-startup-smoke.cjs`，RED 为 exit 1，同一 App 注册前初始化错误。

使用官方 [`mini.webpackChain`](https://github.com/nervjs/taro-docs/blob/master/docs/config-detail.md) 扩展，仅当 TARO_ENV=weapp 挂载 `config/mini-raf-provider.ts`：parser expression hook 只针对 `@tarojs/runtime/dist/bom/raf.js` 的两个标识符提前返回，避免 provider 向实现本身注入自引用。保留所有其他模块的 ProviderPlugin 定义、原有 setTimeout/clearTimeout 回退，不改 node_modules 或业务源码。

修复后重新 `npm.cmd run build:weapp`，成功 27.04s；再执行同一启动 smoke，GREEN 为 exit 0：`WeChat emitted App/Page startup and RAF timer/cancellation smoke passed.`。完整构建日志 `.qa/weapp-startup-build.log`。全量业务测试 71 passed / 0 failed，typecheck、diffcheck 通过；启动 smoke 为独立产物检查，不计入这 71 项。官方 IDE 冷启动与实际页面验收由主智能体执行，此 VM 检查不能代替平台验收。

历史证据界限：README 的旧 MVP 成功记录写明“dev:weapp持续编译运行”；本次为生产构建。没有保留旧 MVP 编译产物的逐模块快照，尚不能证明业务导入或某个生产优化是唯一差异来源。已确认当前故障在用户 auth 初始化开始前发生，并通过精确绕过 RAF 自引用使相同真实产物启动转绿。

后续验证顺序：`npm.cmd run build:weapp` → `node tests/weapp-startup-smoke.cjs` → 官方微信 WXSS/IDE 冷启动与页面验收。禁止仅依据构建成功宣称平台启动正常。

## 2026-10-26 刷新队列的第二次报告提交边界

质量复查补充场景：旧 GET → 报告一提交 → 补发 GET2 开始 → 报告二提交。原去重标记持续到 GET2 完成，报告二误复用该请求，最终显示 40 XP 而非累计 80。新增两个真实 `createSessionAccess.report` 操作与 deferred GET 回归；`npx.cmd tsx --test tests/cloud-session.test.ts` RED 为 7 passed / 1 failed，断言 `40 !== 80`。

最小修复将去重标记限定为“等待补发”，补发 GET 开始时只清除自己的标记，后续提交可排队 GET3；原 finally 的身份比较防止清除更新的队列。定向 auth + cloud-session GREEN 为 26 passed；最终全量 71 passed / 0 failed，typecheck 通过。并发等待去重、登录周期与昵称保护回归仍通过。

本次最终 H5 重建成功（27.407s，仅既有包体积提示），weapp 重建成功（12.44s）。日志为 `.qa/cloud-tests-final.log`、`.qa/cloud-typecheck-final.log`、`.qa/cloud-h5-build.log`、`.qa/cloud-weapp-build.log`；`git diff --check -- frontend` 通过。

## 2026-10-26 最终质量审查：报告提交后的资料刷新

独立质量审查发现：报告事务提交 40 XP 后，资料刷新可能复用事务前已发出的 GET，导致最终报告显示 40 XP、个人资料仍显示 0。先以真实 `createAuthStore` + `createSessionAccess.report` 组合和 deferred 旧 GET 补回归，连同并发 force、登录周期切换和昵称保存保护测试，`npx.cmd tsx --test tests/auth.test.ts tests/cloud-session.test.ts` RED 为 21 passed / 4 failed，XP 断言为 `0 !== 40`。

增加 `refreshProfile(true)`：若旧 GET 正在执行，等待后补一条新 GET，并发强制刷新共用该后续操作；报告保存回调使用该模式。排队时捕获登录 epoch、Token、用户 ID，等待后身份变化即放弃；响应同时保留登录周期和 `profileRevision` 校验，迟到 GET 不能覆盖新昵称或其他登录周期。GREEN 为 25 passed。最终全量 `npm.cmd test` 70 passed / 0 failed、`npm.cmd run typecheck` 通过，日志为 `.qa/cloud-tests-final.log` 和 `.qa/cloud-typecheck-final.log`。

修复后重建 H5 成功（32.89s，仅既有 349 KiB 入口/245 KiB JS 包体积提示），weapp 成功（17.90s）；构建日志仍为 `.qa/cloud-h5-build.log` 和 `.qa/cloud-weapp-build.log`。

## 2026-10-26 账号云端题库与全部页面

在已通过的 46 项首样品测试基础上继续 TDD。`npx.cmd tsx --test tests/cloud.test.ts` 首次 RED 为 6 failed，缺少 history/detail API 与云端详情适配器；实现后同命令 6 passed。覆盖服务端搜索编码、分页和取消、错误载荷、账号切换、canonical 报告、原题重算正确性、未知/重复/缺失题号、空答案缓存恢复，提交行为仍拒绝空答案。

`npx.cmd tsx --test tests/history.test.ts` 首次 RED 为 4 failed，缺少共享云端 history store；实现后 4 passed。覆盖账号切换立即隔离与取消、迟到响应忽略、分页去重、服务端搜索、刷新失败保留缓存、重试、本机进度覆盖和未同步记录独立展示。

`npx.cmd tsx --test tests/cloud-session.test.ts` 首次 RED 为 6 failed，缺少云端 session access；实现后 6 passed。覆盖云端已存在报告不再调用 AI、本机完整报告离线直开、云端 pending 保留本机作答后只生成一次并触发一次刷新、云端读取失败不清除记录、切换账号和取消后禁止写入。

自查发现同步鉴权异常发生在第一次 await 前时，history store 的已结束 Promise 可能留在进行中槽位，导致恢复原账号后无法重试。补回归后 RED 为 11 passed / 1 failed（cloud + history），最小修复后 history 5 passed。另补三/四题与外来报告 ID 验证，以及云端 pending 筛选下本机已完成覆盖保留：后者 RED 为 5 passed / 1 failed，按云端状态筛选后 GREEN 为 6 passed，界面明确标记“本机已完成 / 报告待同步”，数量仍使用云端口径。

最终 `npm.cmd test` 为 65 passed / 0 failed，原有 46 项守卫测试均保留；`npm.cmd run typecheck` 通过。`npm.cmd run build:weapp` 成功（24.70s）；`npm.cmd run build:h5` 成功（43.49s），有现有 Webpack 包体积提示：app entry 349 KiB / app JS 245 KiB。完整构建日志在忽略目录 `.qa/cloud-weapp-build.log` 和 `.qa/cloud-h5-build.log`。本轮未调用付费 AI、未重启服务；实际浏览器与微信验收由主智能体执行，不能用单元测试替代。

## 2026-10-26 用户系统首个样品

先新增 auth/user-api 与账号缓存隔离测试：`npm.cmd test`，RED 为 21 passed / 16 failed，缺少认证状态、用户接口及作用域切换；随后最小实现，GREEN 为 37 passed。

补充旧报告回调跨账号污染与“服务端将过期 Token 降为游客却被误认云端保存”两项测试：RED 为 37 passed / 2 failed；加入带作用域的保存和 X-Learning-User 响应确认后 GREEN 为 39 passed。用户系统请求仍保留原有取消和 60 秒超时。

运行中 Token 到期测试：RED 为 11 passed / 1 failed；请求读取身份时检查到期并清理后，同一 auth 测试 GREEN 为 12 passed。旧请求只能清理其自己的 Token，不能清除后来登录的用户。

首个样品已执行类型检查、H5 构建和实际浏览器验证：测试账号 A 登录、修改昵称为“学习咩同学”、刷新仍从数据库读取；浏览器错误列表为空。预览 http://127.0.0.1:10086/#/pages/profile/index，原始截图保存在主目录 docs/verification/user-profile-sample.png 和 user-profile-edit.png。数据库真实运行，身份使用明确标注的本地开发测试账号，真实微信登录待凭据。

独立规格审查复现旧 GET 覆盖新昵称，以及 API 已校验后、页面 await 恢复前切换账号造成题库写错缓存。昵称竞态和受控微信重登先补测试：auth RED 为 12 passed / 2 failed，再以资料版本号及单次重登去重修复。出题页和报告页都在请求前捕获存储 scope，保存时再次校验。全量前端 GREEN 为 42 passed，类型检查通过。核心变更请求不自动重放；重登只恢复身份，原作答仍可手动重试。

质量审查回归：设备写入失败→恢复成功仍留旧告警，先运行 services 测试为6 passed/1 failed，再将恢复警告与写入失败提示分开。圆环新增320/375/414及非正方形尺寸回归先4 failed（几何函数缺失），后按实际画布像素计算坐标；resize时重新查询，异步过期绘制会失效。

规格审查回归：合法题号 `toString` 与 Object 原型同名时，新关卡被误判有记录，重开会被当损坏缓存丢弃。先加入回归并运行：9 passed / 1 failed，断言恢复关卡数 0 !== 1。随后使用自有属性检查统一读取记录，避免原型继承值影响界面与恢复。

domain 首轮 GREEN：同一命令 9 passed、0 failed，无警告。

services/storage 首轮 RED：`node --test tests/services.test.ts`，6 failed，均为尚未实现的 createApi/createLearningStore 缺失；无收集错误。

services/storage GREEN：`node --test tests/*.test.ts` → 15 passed / 0 failed。实际覆盖请求错误/非法成功响应/取消、设备写入失败时内存保留、订阅解除等行为。

页面首轮已编译 H5。类型检查暴露 Taro 自带的其他平台声明错误，采用 skipLibCheck，仅跳过依赖声明检查，业务源码仍完整检查；修正脚手架未使用参数和 app 级无效 disableScroll 后，`npm run typecheck` 通过。

实际浏览器样式检查发现 Taro H5 把 disabled=false 作为字符串属性，组件默认 CSS 因属性存在而改变颜色；Btn 仅在禁用时传该属性。默认按钮宽度与间距亦已按原型覆盖。方形 SVG 图标改用 scaleToFill，避免 H5 aspectFit 内部尺寸计算把图标缩为一半。所有路径均来自原型。

2026-10-25：执行 `node --test tests/domain.test.ts`，实现之前 9 项测试全部失败，原因是 learning 模块尚不存在、预期函数缺失。已确认不是测试收集错误。测试覆盖输入码点、题库契约、提交、计分、多选、报告、累计统计、缓存损坏和报告失败恢复。

脚手架：Taro 官方 CLI 4.3.1 默认 React/TypeScript/Webpack5 模板。CLI 的 `--npm npm` 值和 Rust NpmType 枚举大小写不一致，查明官方源码后使用同一 CLI Project 生成器的 `Npm`/`None` 枚举完成初始化，未手写基础模板。禁用自动依赖安装，移除脚手架自动初始化且无提交的嵌套 Git 目录。

最终渲染回归：纯 ringGeometry 测试通过仍不足以证明圆环实际绘制。真实浏览器探针在320/375/414及同页resize得到ink=0，增加像素断言后脚本RED。定位Taro H5 Canvas首次自动设置位图尺寸触发额外render清空画面；固定168×168位图、按168坐标绘制并在浏览器frame执行，CSS保持原型84设计尺寸，小程序独立测量外层View实际像素。GREEN：最终主目录浏览器脚本8个探针均6105或6155个非透明像素，覆盖回看题目、建议展开/收起、三种屏宽及同页resize；同时检查足够位图分辨率和探针数量。Taro切页时DOM可先于动画稳定出现，脚本等待stationed状态后再点击，避免过渡位置造成无效点击。

主目录最终验证：npm.cmd test 21 passed；npm.cmd run typecheck通过；H5构建通过（303KiB入口体积提示）；weapp构建Compiled successfully。固定数据浏览器完整五题、报告、统计、搜索筛选和回看回归通过；真实AI10组题库/报告单独记录在仓库验收文档，不混作UI测试。
2026-10-26 微信原生回归：游客模拟器首屏显示WXSS编译失败。官方wcsc定位app.wxss(27:1) unexpected token `*`。先新增并运行tests/weapp-wxss-smoke.cjs，RED exit1、1 !== 0，确认Taro的Webpack构建未执行原生样式解析。最小修复将共享reset改为page/view/text/button/input/textarea/image/canvas/scroll-view选择器，H5通过平台条件require独立保留原来的通配reset。GREEN：同一官方编译测试exit0；类型检查、原有21测试和H5构建通过。独立复审确认两端构建产物选择器正确，无新增问题。

游客模拟器真实测试：官方auto成功使用touristappid，SDK connect9420获取pages/index/index，截图首页正常。实际生成5题；脚本发现SDK的button.property('disabled')返回字符串false，修正测试判断后复用原题库继续，未重复出题。前三单选、多选、判断均提交；首题退出到题库后恢复，只有一条记录和原位置；最终4/5、80%、40XP，报告/回看/个人统计一致，运行时异常0。截图和安全步骤记录在docs/verification/weapp-*。
H5 focused回归通过：实际浏览器中app-shell、textarea-wrap、生成按钮和tab-bar四处computed boxSizing均为border-box，浏览器错误列表为空，确认原型重置行为保留。
