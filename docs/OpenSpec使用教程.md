# 学习咩 · OpenSpec 使用教程

OpenSpec 用来保存“要做什么、为什么这样做、如何验收”，方便后续功能持续维护。这个仓库已经接入，不需要重新初始化；普通目录和文档整理也不必伪装成一个新功能变更。

## 一、仓库里已有些什么

先读主规范了解已同步的行为，再读进行中的变更。代码、当前项目说明与尚未同步的变更需要一起核对，不能只看归档判断某个功能是否实现。

```text
openspec/
├── README.md            # 主规范、归档与参考资料的区别
├── config.yaml          # 当前 schema: spec-driven
├── specs/               # 已同步的行为规范
└── changes/
    └── archive/         # 当前项目自己的已完成变更
```

知识库变更已于 2026-10-30 同步主规范并归档，目前没有进行中的变更。任务完成、主规范同步和归档分别核对，不能只看任务是否打勾；当前归档清单见 [OpenSpec 导航](../openspec/README.md)。

## 二、先检查当前环境

本机检查版本为 1.15.0。以下是在项目根目录运行的只读命令；若本机没有 CLI，先与维护者确认安装版本，不要为了阅读项目而自动初始化或升级。

```powershell
openspec.cmd --version
openspec.cmd list --json
openspec.cmd status --help
openspec.cmd validate --all --strict
openspec.cmd validate --archived
```

macOS/Linux 或其他 shell 使用 `openspec`。创建新的进行中变更后，再用 `status --change` 查询其状态；已经归档的变更直接阅读 archive 下的资料，不再使用旧活动名称查询。CLI 参数以本机 `--help` 为准。

## 三、开发一项功能

一次变更围绕一个明确目标，先整理输入、输出、异常情况和验收，再按任务实现。不要同时引入另一套主流程来重复维护相同需求。

| 阶段 | 要完成什么 | 本仓入口 |
| --- | --- | --- |
| 提案 | 背景、范围、规格、设计、任务 | `openspec-propose` 技能或 `.github/prompts/opsx-propose.prompt.md` |
| 实现 | 按 tasks 修改代码，执行相关测试 | `openspec-apply-change` 或 `opsx-apply.prompt.md` |
| 更新 | 需求变化时更新当前变更 | `openspec-update-change` 或 `opsx-update.prompt.md` |
| 同步 | 将已实现的 delta specs 合并到主规范 | `openspec-sync-specs` 或 `opsx-sync.prompt.md` |
| 归档 | 检查任务、验证和同步状态，保存变更历史 | `openspec-archive-change` 或 `opsx-archive.prompt.md` |

在支持 OPSX 命令的宿主中，官方示例使用 `/opsx:propose`、`/opsx:apply`、`/opsx:sync`、`/opsx:archive`。本仓 Copilot prompt 文件名是 `opsx-propose` 等，具体输入以聊天界面展示的命令为准；Codex 可直接使用自然语言请求并读取已有技能，不依赖 Copilot 专属命令。

## 四、验证、同步与归档

格式验证只证明规范格式满足工具要求，不能证明功能正确。完成实现后还需运行[维护指南](项目维护指南.md)中的代码检查，并留下实际体验结果。

同步会修改 `openspec/specs/`；归档会移动变更目录，并可能提示先同步。只有在确认实现、差异和验收范围后再执行，不能把“归档成功”理解成自动完成了所有验收。

命令和行为已通过 Context7 核对[官方命令说明](https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md)与[工作流说明](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)，具体可用参数另以本机 `--help` 为准。
