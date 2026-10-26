# 学习咩小程序前端

使用 Taro 4.3.1 官方默认脚手架生成，React 18 + TypeScript + Webpack5。页面与图标依据仓库 `prototype/`，未添加新的设计方向。

## MVP 功能

包含输入、答题、报告、题库和“我的”五页。支持单选/多选/判断、提交后讲解与XP、退出恢复、报告失败重试、题目回看、题库搜索筛选、个人统计，以及本机记录保存。首个样品方向已由用户确认。实际验收证据与尚未验证事项见仓库 `docs/开发进度.md`。

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
```

自动化测试只替换外部请求，覆盖真实判题、缓存恢复和请求错误行为。`TDD.md` 保存 RED/GREEN 证据。skipLibCheck 只跳过 Taro 等依赖的跨平台声明检查，业务源码仍参与检查。

## 使用固定内容检查界面

此模式专用于开发验证，不能用于真实 AI 质量验收；生产代码没有固定题目回退。

在前端目录，用另一个终端执行：

```powershell
../backend/.venv/Scripts/python.exe tests/qa_server.py
```

该服务只绑定 `127.0.0.1:8000`，注入原型固定 AI 内容，保留真实 FastAPI 契约和计分服务；不使用付费模型。先停止真实后端以避免占用同一端口。切回真实联调前，按 Ctrl+C 停止测试服务，再按后端 README 启动真实服务。

本机保存的是当前设备的题库、作答与报告，不提供跨设备同步。清除应用数据会移除本机记录；存储失败会在页面中说明，当前内存中的作答仍可继续。

## 微信游客模拟器验证（2026-10-26）

已使用touristappid与官方CLI `auto --project <frontend绝对路径> --auto-port 9420` 打开并验证。普通 `open` 在本机版本返回AppID不存在，auto入口可正常运行。用户已手动开启工具服务端口；不需要注册真实AppID进行本地游客模拟器测试。原生窗口控制不可用时，使用官方miniprogram-automator0.13.0的connect接口测试，不修改产品依赖。

已测通真实出题、三种题型提交、退出续答、报告与回看、个人统计；4/5正确显示80%/40XP，运行时未捕获异常。IDE已保留在首页，dev:weapp持续编译运行。

Taro构建成功不代表WXSS通过原生编译。发现并修复通配选择器不受支持的问题，新增官方编译器回归；安装微信工具时可在本目录执行：

```powershell
node tests/weapp-wxss-smoke.cjs 'D:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcsc.exe'
```

编译器路径按实际安装位置调整。H5保留原型通配reset，小程序改用原生组件标签reset；颜色、间距和交互未另行设计。真机仍需单独配置并验证。