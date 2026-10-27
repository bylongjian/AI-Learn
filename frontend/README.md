# 学习咩小程序前端

使用 Taro 4.3.1 官方默认脚手架生成，React 18 + TypeScript + Webpack5。页面与图标依据仓库 `prototype/`，未添加新的设计方向。

## MVP 功能

包含输入、答题、报告、题库和“我的”五页。支持单选/多选/判断、提交后讲解与XP、退出恢复、报告失败重试、题目回看、题库搜索筛选、个人统计，以及账号云端题库和报告。实际验收结果与尚未验证事项见 [用户系统验收记录](../docs/用户系统验收记录.md)。

## 本地运行

在本目录执行：

```powershell
npm.cmd ci --registry=https://registry.npmjs.org
Copy-Item .env.example .env
npm.cmd run dev:h5
```

复制配置前检查 `.env` 是否已存在；存在时保留并修改，不覆盖。默认后端为 `http://127.0.0.1:8000`，H5 预览为 `http://127.0.0.1:10086`。

真实后端启动见 `../backend/README.md`。DeepSeek Key 只保存在后端 `.env`；前端配置只有 API 地址和 AppID。修改前端环境变量后重新编译。

## 小程序构建

```powershell
npm.cmd run build:weapp
```

用微信开发者工具导入本目录的 `project.config.json`，它指向 `dist/weapp`。默认 AppID 是 touristappid；真机和正式环境需配置自己的 AppID、手机可访问的后端地址及对应微信合法域名。微信系统状态栏和胶囊使用平台能力，H5 中的状态栏只用于原型对照。

## 测试与检查

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build:h5
npm.cmd run build:weapp
node tests/weapp-startup-smoke.cjs
```

核心自动化测试 57 项通过，覆盖学习闭环、缓存恢复、账号隔离、云端历史和请求错误行为。测试替换外部请求，不消耗模型额度。skipLibCheck 只跳过 Taro 等依赖的跨平台声明检查，业务源码仍参与检查。

小程序生产构建后必须运行启动 smoke：它直接加载 `dist/weapp` 的真实入口与拆分模块，检查 App、首页 Page 能注册，并检查 Taro 的 RAF 定时器与取消能力。仅 Webpack 显示 `Compiled successfully` 不足以证明应用可以启动；此检查也不能替代微信开发者工具或真机验收。

Taro 4.3.1 在当前构建环境中会向自身 RAF 实现注入 runtime 总出口，导致 App 注册前出现循环依赖的初始化错误。仅微信构建通过官方 `mini.webpackChain` 加载精确模块 guard，阻止 `runtime/dist/bom/raf.js` 内两个 RAF 标识符的自注入；其他模块的全局注入、runtime 原有定时器回退以及 H5 配置均保留。无需修改 `node_modules`。

## 数据边界与登录

游客的题库、作答与报告保留在当前设备。登录后，后端保存该账号生成的题库和完成的报告；首页显示真实昵称、累计 XP 和最近报告，“我的”和题库支持云端分页，题库的关键词和状态筛选由服务端执行。清除设备数据后，可从原账号重新读取云端报告；已有云端报告直接打开，不重复调用 AI。

未完成的作答进度只保留在当前设备；其他设备打开尚未完成的云端题库时从第一题开始。账号切换立即隔离草稿、进度、报告和云端列表，游客数据不会自动迁入账号。题库数量与筛选按云端统计，本机续答和待同步报告另行标注；网络失败时保留缓存并提供重试，已有本机完整报告可离线打开。设备存储失败时会提示，当前内存中的作答仍可继续。

新报告保存成功后会重新读取账号统计；已有资料请求尚未完成时，会在其结束后补读一次，避免显示报告保存前的旧 XP。刷新仍遵守账号隔离和昵称保存保护。

微信小程序使用平台登录；H5 默认游客模式。仅当 `TARO_APP_DEV_LOGIN=true` 且 API 地址为本机 `http://127.0.0.1` 或 `http://localhost` 时，“我的”提供明确标注的测试账号 A/B。正式微信登录还需要后端配置真实微信凭据。昵称支持保存到账号，头像展示后端返回的地址。前端不包含后端密钥。

## 微信游客模拟器验证（2026-10-26）

已使用touristappid与官方CLI `auto --project <frontend绝对路径> --auto-port 9420` 打开并验证。普通 `open` 在本机版本返回AppID不存在，auto入口可正常运行。用户已手动开启工具服务端口；不需要注册真实AppID进行本地游客模拟器测试。原生窗口控制不可用时，使用官方miniprogram-automator0.13.0的connect接口测试，不修改产品依赖。

原有核心已测通真实出题、三种题型提交、退出续答、报告与回看、个人统计；4/5正确显示80%/40XP，运行时未捕获异常。本轮用户系统又完成云端报告无缓存恢复、账号统计、游客真实出题续答与报告、重登后游客数据保留的官方模拟器复验，异常为0。

Taro构建成功不代表WXSS通过原生编译。发现并修复通配选择器不受支持的问题，新增官方编译器回归；安装微信工具时可在本目录执行：

```powershell
node tests/weapp-wxss-smoke.cjs 'D:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcsc.exe'
```

编译器路径按实际安装位置调整。H5保留原型通配reset，小程序改用原生组件标签reset；颜色、间距和交互未另行设计。真机仍需单独配置并验证。
