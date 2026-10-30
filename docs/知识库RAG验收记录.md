# 私有知识库与 RAG：验收记录和手工体验

本次已经接入私有文档上传、后台处理、文档出题和两级降级。用户后续明确授权“/playwright 你自行验收体验”，助手已完成代理体验验收。**主规范尚未同步，变更尚未归档，等待用户最终确认。**

记录日期：2026-10-30。变更：[add-private-knowledge-base-rag](../openspec/changes/add-private-knowledge-base-rag/)。用户已确认样品反馈：“清楚，沿用当前布局和文案”。这次确认针对样品入口、上传顺序和未核实提示，不代表真实 AI 质量已经验收。

## 1. 已验证什么

测试分为业务自动化、模拟界面和真实联调。业务自动化使用真实的独立 MySQL 测试库与临时 Chroma，替换外部网络及模型响应，不消耗 AI 额度。用户填写百炼配置后，另行执行了真实百炼、Tavily、DeepSeek 联调；以下分别记录，不能混为同一种依据。

| 检查 | 实际结果 | 依据 |
| --- | --- | --- |
| 后端完整回归 | 213 passed | 在 `backend` 执行 `./.venv/Scripts/python.exe -m pytest -q --tb=short`，107.04 秒 |
| 依赖兼容 | 通过 | `./.venv/Scripts/python.exe -m pip check`：No broken requirements found |
| 前端完整回归 | 76 passed | 在 `frontend` 执行 `npm.cmd test` |
| TypeScript | 通过 | `npm.cmd run typecheck` |
| 微信生产构建 | 通过 | `npm.cmd run build:weapp` |
| H5 生产构建 | 通过，有两个体积提示 | `npm.cmd run build:h5`；主 JS 约 254KiB，入口合计约 359KiB |
| 微信启动及原生样式编译 | 通过 | `node tests/weapp-startup-smoke.cjs`；`node tests/weapp-wxss-smoke.cjs <wcsc.exe路径>`，编译四份样式 |
| 数据库升级 | 通过 | 测试库重复升级保留题库；本机应用执行 `python -m scripts.init_db` 成功 |
| 四种文件解析 | 通过 | 实际解析 PDF、DOCX、MD、中文 TXT；无文字 PDF、损坏文件及解析超时有明确失败 |
| 文档生命周期与隔离 | 通过 | 就绪、处理中删除、重启恢复、失败清理、双账号隔离、12 次并发只接受 10 篇 |
| 文档→联网→模型 | 通过 | 验证顺序、共享预算、真实 Chroma 检索和来源保存；外部模型与搜索响应为 mock |
| 非资料错误 | 通过 | 登录、归属、未就绪、依据审核、删除竞态、保存失败均不转模型题 |
| H5 学习流程 | 通过，模拟服务 | TXT 文件上传、轮询就绪、编辑主题、五题答题、100%/50XP、报告及题目回看保留未核实提示 |
| 微信学习流程 | 通过，模拟服务 | 官方开发者工具：上传、五题答题、报告；未核实提示在作答前及报告可见，完成该轮时无运行异常 |
| H5 取消和操作异常 | 通过，受控模拟 | 空文件选择与 cancel 事件不上传；503 配置提示可见；删除失败后可重试至列表消失 |
| 领域选项与删除交错 | 通过，实际 H5 控件＋模拟响应 | 出现领域选项后删除文档，或刷新发现文档被其他设备删除，均清除选项，无遗留入口 |
| 本机与云端恢复 | 自动化通过，真实跨端通过 | 微信读取 H5 报告；清除 H5 本机学习缓存后云端恢复；文档引用、生成方式与账号隔离一致 |

代码审查后还修复了四个真实问题：反复取消不能让未结束的 Chroma 写入越过删除；文档资料不足时给独立网页来源留位置；旧刷新不能覆盖删除后的列表；删除或刷新移除文档后清除领域选项。删除与刷新交错的测试先失败，再随修复通过。

真实联调又发现并修复了两项问题，同样先补失败用例，再修改实现：文档重试的已知服务故障不能取消并行联网搜索；微信上传显式传递原文件名，避免临时文件名丢失扩展名、影响格式判断和列表展示。原文件名仍经过服务端清理、实际大小限制和解析，不用客户端声明绕过校验。

测试库名称必须以 `_test` 结尾，测试配置来自被忽略的 `backend/.env.test`，不会清理应用数据库或实际文档目录。界面验收截图在本机忽略目录 `output/playwright/`，不是实际云端调用证明：

- [H5 知识库样品](../output/playwright/rag-sample-library.png)、[H5 作答前提示](../output/playwright/rag-sample-fallback.png)、[H5 报告](../output/playwright/rag-h5-report.png)。
- [微信知识库](../output/playwright/rag-weapp-library.png)、[微信作答前提示](../output/playwright/rag-weapp-fallback.png)、[微信报告](../output/playwright/rag-weapp-report.png)。

### 真实云端联调

本次使用公开测试讲义和本地测试账号 A，没有上传用户私有资料。故障场景仅在隔离应用配置中使用无效百炼 Key 或关闭联网，没有修改用户已填写的 `.env`；这模拟的是调用方配置故障，不代表云服务本身宕机。

| 场景 | 实际结果 | 依据 |
| --- | --- | --- |
| TXT 上传、解析、真实百炼向量化 | 202 后约 2.05 秒就绪，1 个片段 | `output/playwright/rag-real-api.json` |
| 真实 Chroma 检索、DeepSeek 出题及核验 | 200，五题，7.44 秒，`generation.mode=document`，云端往返一致 | 同上；抽查导入步骤、重叠分块、模型维度、权限与 JSON 事实核验五题，均能对应讲义 |
| 实际 H5 文件上传 | Markdown 经 FormData 上传并就绪 | [真实 H5 知识库](../output/playwright/rag-real-h5-library.png) |
| 实际 H5 答题、引用与报告 | 四题正确、一题故意选错，报告 80% / 40XP，来源可展开 | [文档引用](../output/playwright/rag-real-h5-source.png)、[真实报告](../output/playwright/rag-real-h5-report.png) |
| 官方微信模拟器真实请求 | TXT 上传并保留原名、真实文档出题、读取 H5 的云端报告 80% / 40XP，无运行异常 | [微信真实知识库](../output/playwright/rag-real-weapp-library.png)、[微信真实答题](../output/playwright/rag-real-weapp-quiz.png)、[跨端报告](../output/playwright/rag-real-weapp-cloud-report.png)；仅聊天文件选择器用本地临时文件替代，上传、数据库与云服务请求均为真实调用 |
| 文档不可用，真实 Tavily 联网补充 | 200，约 20.0 秒，`web_fallback`，原因 `document_unavailable`，云端保存一致 | `output/playwright/rag-real-web-trace.json`；真实工具调用日志及资料充分性判断为 ready |
| 文档不可用且关闭联网，真实模型兜底 | 200，约 5.52 秒，`model_fallback`，`reference=null`，云端往返一致 | `output/playwright/rag-real-fallback.json` |
| 联网资料准备超过预算 | 一轮达到 25 秒资料上限后正确转模型，完整请求约 30 秒 | 同场景早期复验结果；不能保证每次联网均成功，不放宽已确认的等待上限 |
| 删除、恢复与换账号 | 真实删除本次测试文档；清除本机学习缓存后仍能从云端恢复报告和摘录；B 空列表，切回 A 恢复自己的文档 | [删除后仍保留的引用](../output/playwright/rag-real-retained-reference.png) |
| 双端降级历史回看 | 微信和 H5 均打开真实云端模型兜底与网页依据题库，生成方式提示保留 | [H5 未核实提示](../output/playwright/rag-real-h5-model_fallback.png)、[H5 网页依据](../output/playwright/rag-real-h5-web_fallback.png)、[微信未核实提示](../output/playwright/rag-real-weapp-model_fallback.png)、[微信网页依据](../output/playwright/rag-real-weapp-web_fallback.png) |
| 用户授权的 Playwright 手机体验 | 375×812 视口，从知识库编辑主题并实际出题、查看引用、完成五题与报告回看；80% / 40XP，无浏览器 pageerror，报告页无横向溢出 | [手机答题](../output/playwright/rag-self-mobile-quiz.png)、[手机引用](../output/playwright/rag-self-mobile-reference.png)、[手机报告](../output/playwright/rag-self-mobile-report.png)；题库 `2fd55270-1a4f-46b8-8fdd-757abf106618` |

真实调用过程中发现过提前取消联网的问题，修复及回归已完成；最终代码还验证了首次检索成功、私有重试才临时失败的并行情形。真实题目只是一次抽样，不能据此保证模型长期准确。

## 2. 第一次启动怎么做

建议先用 H5 体验，文件选择最直接。已有 `.env` 时只补缺失项，不要用示例覆盖已有配置；本次没有改写真实密钥。

### 后端

在项目根目录打开 PowerShell，执行以下命令。本机已安装依赖并完成数据库升级；换机器时需要重复安装和初始化。

```powershell
cd backend
./.venv/Scripts/python.exe -m pip install -r requirements.txt
# 仅首次、且没有 .env 时：复制 .env.example 为 .env，随后编辑。
./.venv/Scripts/python.exe -m scripts.init_db
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

没有虚拟环境时先运行 `py -3.11 -m venv .venv`。MySQL 数据库和账号须事先存在，连接配置沿用原有用户系统；不要把应用数据库名写进 `.env.test`。

在 `backend/.env` 中准备下列配置，修改后重启后端。**目前本机百炼配置已填写并通过真实调用验证。** 换环境仍需自行配置，密钥不记录在本文中。

| 配置 | 用途 |
| --- | --- |
| `MYSQL_*`、`JWT_SECRET` | 登录、文档记录、题库与报告保存；沿用已有配置 |
| `APP_ENV=development`、`DEV_LOGIN_ENABLED=true` | 允许仅本机使用测试账号 A/B |
| `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL` | 必需：文档与查询向量化；从百炼控制台复制匹配地域、业务空间的兼容地址，结尾 `/compatible-mode/v1` |
| `DASHSCOPE_EMBEDDING_MODEL=text-embedding-v4`、`KB_EMBEDDING_DIMENSIONS=1024` | 保持默认；改变模型、维度或地址后旧文档须删除重传 |
| `DEEPSEEK_API_KEY` | 必需：资料判断、出题、审核与报告；模型 Key 不可用时无法保证兜底成功 |
| `TAVILY_API_KEY`、`ENABLE_WEB_SEARCH=true` | 联网补充；关闭或缺失时，文档不足可转模型练习 |

使用一个 API worker，不加 `--workers 2`。MySQL 与 `backend/data/chroma` 需要配套备份，不能把数据目录当静态文件公开。配置完整说明见 [backend/.env.example](../backend/.env.example)。

### 前端

再开一个 PowerShell，在项目根目录执行：

```powershell
cd frontend
npm.cmd install
npm.cmd run dev:h5
```

浏览器打开 `http://127.0.0.1:10086`。本机测试登录需在 `frontend/.env` 设置 `TARO_APP_DEV_LOGIN=true`，API 地址为 `http://127.0.0.1:8000`，然后重新构建。该地址不同于本次自动化使用的 10087 模拟服务窗口，人工验收请使用新打开的普通浏览器窗口。

微信端先运行 `npm.cmd run build:weapp`，在微信开发者工具导入 `frontend`，本地模拟器可使用 touristappid。若微信工具安装在本机当前目录，也可执行：

```powershell
& 'D:/微信web开发者工具/cli.bat' auto --project (Get-Location).Path --auto-port 9420 --lang zh
```

仅本地调试可在开发者工具中关闭合法域名校验。真机和正式环境需要自己的 AppID、可访问的 HTTPS 服务及合法 request/uploadFile 域名，不能用手机访问 `127.0.0.1`。

## 3. 正常情况，照着点一遍

准备文件可直接用 [中文 TXT 样本](../backend/tests/fixtures/knowledge-course.txt)。真实模型有变化，“有依据生成”与“明确拒绝不足资料”都可能合理，重点检查来源、题目和答案是否一致，不能只看是否生成成功。

1. 打开“我的”，选“测试账号 A”，进入“我的知识库”。确认只有自己的文档，上传前能看到格式、10MB 和隐私说明。
2. 点“选择文档上传”，先取消一次，应没有错误和新增文档；再次选择 TXT 样本。先看到“处理中”，此时不能开始闯关；完成后变为“已就绪”。后台处理含排队最多 180 秒。
3. 把学习主题改为“RAG 的检索、向量与来源核验”，点“开始闯关”。有领域选项时选具体领域；资料足够应标记依据文档，必要时补充网页。
4. 回答五道题。每题提交后检查讲解、来源摘录；PDF 来源应有真实页码，TXT 不应编造页码。多选必须全部选对才得分，每题正确加 10XP。
5. 完成后检查报告正确率与 XP；展开“回看本轮题目”，来源与生成方式应保留。回题库重新打开，再换另一客户端登录 A，查看云端题库与报告；中途答题进度仍只在原设备保存。
6. 回知识库删除文档，等待列表消失。已有题库、报告和引用摘录仍可读；原文档不能再开始新练习。
7. 切换“测试账号 B”，应看不到 A 的文档。切回 A 验证列表恢复。再试 MD、DOCX 和可复制文字的 PDF；扫描 PDF 应明确失败，不做 OCR。
8. 可选检查额度：第 11 篇和大于 10MB 的文件被拒绝。失败、删除未完成仍占名额，清理完成后才能释放。

## 4. 没配 Key 或遇到异常怎么试

以下操作只改自己的本地验收配置，每组完成后恢复原值并重启后端。不要删除 Chroma 目录来制造检索失败，也不要更改生产配置。

| 想体验什么 | 怎么操作 | 应该看到什么 |
| --- | --- | --- |
| 没有百炼配置 | `DASHSCOPE_API_KEY` 留空，重启后端并上传 TXT | 提示“知识库向量化尚未配置”；不新增处理中记录，也不会假装上传成功 |
| 上传中断 | 上传时停止后端，然后重新启动 | 显示连接错误；先刷新列表确认是否已接受，再决定重传，页面不会自动重复上传 |
| 扫描件或损坏文件 | 有百炼配置后，上传扫描 PDF 或损坏 DOCX | 处理失败且有原因，不能闯关；删除后可重传正确文件 |
| 文档失败后联网补充 | **先用正确配置得到一篇就绪文档**；保持地址、模型和维度不变，仅把百炼 Key 临时改为无效测试值，保持 Tavily/DeepSeek 正常，重启后开始闯关 | 文档阶段失败后尝试联网；网页资料足够时标记联网依据。网页不足仍可能转模型练习，不能强求某次搜索一定成功 |
| 文档和联网都失败 | 沿用上一步就绪文档，再设 `ENABLE_WEB_SEARCH=false`，保持 DeepSeek 正常，重启后开始闯关 | 模型成功时，作答前、每题讲解、报告均提示“模型生成，未依据文档或联网资料核实”；没有伪造引用 |
| 连模型也不可用 | 接上一步，清空 DeepSeek Key 并重启 | 返回明确错误，不返回模拟题库，也不把生成失败当成功 |
| 取消生成 | 出题等待时点“取消等待”或返回个人页 | 停止页面等待，迟到结果不进入其他账号；服务器已接受的工作不因此承诺取消或退款 |

如果一开始所有 Key 都为空，**只能验证登录、列表和缺配置提示**；没有就绪文档，无法直接手工验证模型兜底。无需付费的逻辑验证可运行本文件第 1 节测试；这不能替代真实模型质量验收。

180 秒处理超时、25 秒资料预算、55 秒完整请求、磁盘清理失败、处理中重启与并发删除已通过受控自动化验证。人工不需要反复等待三分钟或破坏文件权限；如需复验，使用独立验收环境和临时目录。登录、归属、未就绪、违规内容、依据审核及保存失败都应报错，不能用模型兜底绕过。

## 5. 代理验收结论与归档前条件

代理体验验收通过，百炼、Tavily、DeepSeek 联合真实调用及双端主要页面已验证，详细边界和结果见上表。真实聊天文件选择、正式微信登录和真机部署仍需实际设备及凭据；小程序自动化仅替代聊天选择器提供测试文件，保留真实上传与云端调用。一次真实抽查不能保证模型长期准确，尤其模型兜底可能过时、答错或偏离原文档。

- [x] 补齐百炼配置，完成真实上传、文档出题、联网补充及模型兜底 API 联调。
- [x] 按用户授权完成 Playwright 与官方微信模拟器代理体验复核，记录真实聊天文件选择及真机的剩余条件。
- [x] 抽查题干、答案与实际来源；确认未核实提示足够醒目。
- [x] 用两个客户端验证同账号历史及删除后引用保留；换账号后无文档串用。
- [ ] 确认真机、正式登录、域名和单 worker 部署条件。
- [ ] 用户最终确认体验通过，再执行规范同步与归档。

反馈时写“步骤编号 + 实际提示 + 预期结果”即可；不要粘贴密钥。收到最终验收确认后，才继续 `/opsx:archive`。
