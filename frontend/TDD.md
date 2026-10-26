# 前端测试记录

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
