# 学习咩 · OpenSpec 导航

`specs/` 描述当前已同步的行为，`changes/archive/` 保存本项目自己完成的变更。参考项目中的提案可用于学习，但不能混在这里，造成这些开发步骤已经在本项目发生过的误解。

## 一、当前主规范

现有五项能力已经通过严格格式校验。知识库的上传处理、资料补充和模型兜底规则已同步，普通出题资料不足时仍暂停，不扩大文档专用降级规则。

| 规范 | 内容 |
| --- | --- |
| [文档管理](specs/knowledge-base-documents/spec.md) | 登录、四类文件、处理期限、状态、隔离、删除与原文件清理 |
| [文档出题](specs/knowledge-base-quiz-generation/spec.md) | 文档优先、联网补充、明确标注的模型兜底、来源、预算与业务错误 |
| [学习资料与来源](specs/web-search-context/spec.md) | 普通输入资料、逐题依据、文档例外、来源、公开 URL 与执行预算 |
| [领域确认](specs/quiz-topic-clarification/spec.md) | 同名主题的领域选择与重试 |
| [页面导航](specs/learning-page-navigation/spec.md) | Tab、切换反馈、报告回看与失败重试 |

## 二、本项目的变更历史

当前没有进行中的变更。两份归档分别记录资料依据优化和私有知识库接入；它们是当前代码的实施背景，不代表生产上线或真机验收已经完成。

| 归档 | 状态 |
| --- | --- |
| [2026-10-30：出题依据与页面交互](changes/archive/2026-10-30-improve-quiz-knowledge-grounding/) | 保留本项目真实迭代历史 |
| [2026-10-30：私有知识库与 RAG](changes/archive/2026-10-30-add-private-knowledge-base-rag/) | 28/28 任务完成；三份主规范已同步，随后归档 |

本次同步修改 13 条既有要求、新增 7 条，保留既有 Purpose、未涉及要求和原场景。已先完成同步核对，再归档，避免重复应用差量；没有修改业务代码、接口、数据库或依赖。

## 三、移出的参考资料

以下两份目录与本机 yu-ai-learn 的对应归档逐文件一致，忽略换行格式后共 11 个文件全部相同。它们的异步出题、启动自动建表、旧模块路径等描述也不属于本仓当前实现，因此从正式 archive 移出，仅作为本机学习参考留存。

| 原目录 | 本次处理 |
| --- | --- |
| `2026-04-17-enhance-quiz-with-web-search` | 移至被 Git 忽略的 `.local/reference-openspec/` |
| `2026-07-22-add-knowledge-base-rag` | 同上；本项目知识库提案保留参考来源说明 |

移出目录不会撤销功能或删除当前主规范；主规范已按本仓实现同步。参考资料的本机副本经 SHA-256 核对完整保留，本次不重写以前的 Git 提交，也不修改参考仓库。

## 四、如何检查

在项目根目录执行下列只读命令。活动列表应为空，五份主规范严格校验通过，两份本项目归档的任务检查通过。

```powershell
openspec.cmd list --json
openspec.cmd validate --specs --strict
openspec.cmd validate --archived
```

新增功能时沿用现有流程创建新变更；不要把已经归档的变更重新当作活动任务。使用方式见[OpenSpec 教程](../docs/OpenSpec使用教程.md)，正式上线待办见[上线前仓库检查](../docs/上线前仓库检查.md)。
