# 学习咩前端

前端使用 Taro 4.3.1、React 18、TypeScript 和 Webpack 5，编译到微信小程序和 H5。六个页面共用学习业务状态，平台文件选择和上传分别适配；首次启动见[本地运行指南](../docs/保姆级本地运行指南.md)。

## 一、本地开发

以下命令在 `frontend/` 执行。锁文件固定当前依赖，已有 `.env` 时保留，只修改需要的字段。

```powershell
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev:h5
```

打开 [H5 预览](http://127.0.0.1:10086)，后端默认 `http://127.0.0.1:8000`。`TARO_APP_API_BASE_URL` 配置 API 地址，`TARO_APP_DEV_LOGIN` 只用于显式本机测试登录；修改后重新编译。后端 Key、数据库密码和微信 AppSecret 不放进前端。

## 二、页面和模块

页面负责呈现和操作，业务状态放在 domain、auth、storage、history 和 services 中。沿用这些边界，避免在页面里重复实现计分、身份和缓存规则。

| 位置 | 内容 |
| --- | --- |
| `src/pages/index/` | 主题、正文、URL 输入；领域选择、生成和取消 |
| `src/pages/quiz/`、`report/` | 提交与讲解、来源、生成方式、报告和回看 |
| `src/pages/library/`、`profile/` | 题库筛选、续答、昵称、账号与学习统计 |
| `src/pages/knowledge/` | 登录后上传文档、处理状态、删除和指定主题出题 |
| `src/domain/` | 数据类型、本机学习状态、计分和云端恢复 |
| `src/auth/`、`storage/`、`history/` | 账号状态、设备缓存和历史列表 |
| `src/services/` | API、学习会话、上传和知识库状态管理 |
| `src/components/` | 页面外壳、来源、文件选择、反馈与公共控件 |
| `config/` | 双端配置和微信 RAF 构建兼容处理 |

微信“闯关、题库、我的”使用缓存 Tab 页和自定义底栏；H5 保留自己的路由。原型参考在 [prototype](../prototype/README.md)，其中的固定模拟数据不会进入真实学习服务。

## 三、构建与微信导入

分别构建两端，产物位于 `dist/h5` 和 `dist/weapp`。微信工具导入 **frontend 目录**，`project.config.json` 的 miniprogramRoot 指向 `dist/weapp`。

```powershell
npm.cmd run build:h5
npm.cmd run build:weapp
```

默认 AppID 为 touristappid，适合本地游客模拟器。真机需要自己的 AppID 和手机可访问的后端地址，正式环境还需 HTTPS 与微信合法域名。微信工具入口和本地域名设置见[运行指南](../docs/保姆级本地运行指南.md)。

### 微信构建兼容处理

当前 Taro 构建曾出现 RAF 自注入循环依赖，因此 `mini-raf-provider.ts` 精确处理对应运行时模块，保留原有定时器回退。修改它需要同时验证真实产物启动，不能只凭 Webpack 构建成功判断。

小程序样式不支持 H5 的通配 reset，`src/styles/` 按平台处理。原生 WXSS 编译检查和启动 smoke 都保留，它们覆盖曾出现过的运行问题。

## 四、学习与数据边界

游客题库、逐题作答和报告保留在设备上。登录后生成的题库、完整最终作答和报告保存在 MySQL，其他客户端可用同账号读取；未完成进度仍只在本机，不把游客记录自动导入账号。

账号切换隔离草稿、进度、报告和列表；迟到响应不能写入新账号。云端已有报告直接打开，不重复调用 AI；读取失败保留本机记录并允许重试。旧题库缺少 reference 或 generation 仍可读，不推断为模型兜底。

普通出题资料不足时暂停并保留输入，歧义时展示领域选项；逐题讲解可展开来源与复制网页链接。文档出题先取文档再联网，仍不足时明确展示未核实提示；作答前、讲解和报告都保留生成方式。

微信使用平台登录，H5 正式使用为游客。只有明确启用开发登录且 API 为本机回环地址时，才显示测试账号 A/B。后端也需开启对应开发配置；这不等于已经验证真实微信凭据。

## 五、私有知识库操作

从“我的 → 我的知识库”进入，未登录时提示登录。微信使用聊天文件选择器，H5 使用浏览器文件选择器；支持 PDF/DOCX/MD/TXT，每篇 10MB、每人 10 篇。

上传后轮询到就绪再出题，页面隐藏后停止本机轮询，服务器已接受的任务继续执行。取消选择不报错，上传结果不明先刷新列表，不能自动反复上传。失败文档可删除重传；删除未完成可重试，既有报告和引用快照保留。

## 六、测试与检查

业务测试使用 Node.js test runner 与 tsx，替换网络和设备边界，不消耗模型额度。类型检查覆盖业务源码；skipLibCheck 仅跳过依赖声明。

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build:h5
npm.cmd run build:weapp
node tests/weapp-startup-smoke.cjs
node tests/weapp-wxss-smoke.cjs 'D:/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcsc.exe'
```

WXSS 编译器路径按本机安装位置调整。`npm test` 运行 `tests/*.test.ts`，两个 smoke 需要先构建 weapp，单独执行。它们验证产物注册、RAF 与原生样式，仍不能替代模拟器和真机体验。

阶段验收摘要见[验收记录索引](../docs/验收记录/README.md)。早期领域确认模拟服务已存档到本机 `.local/archives/backend/scripts/quiz_sample.py`，不参与提交和部署；正式服务入口始终为 `app.main:app`。
