---
kind: upgrade-guide
description: 运行时默认数据根目录从 `~/.dsh` 迁往 `~/.xiaoyuan`，本产品与本机另行安装的上游 dsh 完全隔离。
---
# 默认数据根目录从 `~/.dsh` 迁往 `~/.xiaoyuan`

[English](guide.md) | 中文

## 变更

运行时此前把唯一数据根目录解析为 `$DSH_HOME`，缺省 `~/.dsh`；现在改为 `$DSH_HOME`，缺省 `~/.xiaoyuan`。profile、会话日志、附件、凭据、缓存、语音识别模型和用户全局 `AGENTS.md` 全部落到新根目录下。受影响的是未设置 `DSH_HOME` 的所有运行：harness 不再读取存放在 `~/.dsh` 下的数据，本机另行安装的上游 dsh（仍用 `~/.dsh`）也不会再收到本产品的插件、配置或数据。显式设置的 `DSH_HOME` 与 `dshHome` 配置项行为不变。

## 迁移

1. 迁移需要保留的 profile：`mv ~/.dsh/profiles ~/.xiaoyuan/profiles`（或只复制在用的 profile）。
2. 迁移需要保留的本地状态，均为根目录下的目录或文件：`sessions/`、`attachments/`、`storages/`、`speech-to-text/`、`cache/`、`.env`、`.credentials.yaml`。
3. 若本机另有上游 dsh 在用 `~/.dsh`，保持该目录原样不动。
4. 不带 `DSH_HOME` 启动任意 harness 命令；确认 `~/.xiaoyuan` 出现并在 `sessions/` 下产生新会话日志，且 `~/.dsh` 保持不变。
