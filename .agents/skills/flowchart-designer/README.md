# flowchart-designer — 流程图绘制助手 Skill

**版本**：1.0.0
**标准依据**：GB 1526-89（等同 ISO 5807-1985）

---

## 一、文件清单

```
flowchart-designer/
├── SKILL.md                         # Skill 核心指令文件（必需）
├── README.md                        # 本说明文件
├── references/
│   └── flowchart-standard.md        # GB 1526-89 符号标准参考手册
├── assets/                          # 预留资源目录（当前为空）
└── deployment/
    ├── system_prompt_full.md        # LM Studio 完整 System Prompt
    ├── system_prompt_mini.md        # LM Studio 精简 System Prompt（推荐）
    └── api_example.py               # Python API 调用示例
```

---

## 二、在 WorkBuddy 中使用

### 安装方式

将整个 `flowchart-designer/` 目录复制到：

```
C:\Users\<用户名>\.workbuddy\skills\flowchart-designer\
```

重启 WorkBuddy 客户端后，在对话中直接说：

> "帮我画一个用户登录的程序流程图"

WorkBuddy 会自动调用本 Skill。

---

## 三、在 LM Studio 本地大模型中使用

### 方式A：System Prompt（推荐，最简单）

1. 打开 LM Studio，加载模型（推荐 qwen3.5-9b 或同量级模型）
2. 进入会话设置 → **System Prompt**
3. 将 `deployment/system_prompt_mini.md` 的内容粘贴进去
4. 开始对话即可

> 若模型对符号描述理解不准确，换用 `system_prompt_full.md`（包含完整符号表）

### 方式B：文件上传（LM Studio 0.4.x 支持附件时）

在对话界面点击附件按钮，上传 `SKILL.md` 或 `references/flowchart-standard.md`。

### 方式C：Python API 调用

参见 `deployment/api_example.py`，运行前确认 LM Studio 服务已启动（默认端口 1234）。

```bash
python deployment/api_example.py
```

---

## 四、支持的流程图类型

| 类型 | 描述 |
|------|------|
| 程序流程图 | 表示程序中的操作顺序，含判断、循环 |
| 数据流程图 | 表示数据流向和处理阶段 |
| 系统流程图 | 表示系统操作控制和数据媒体 |
| 程序网络图 | 表示程序激活路径和程序间关系 |
| 系统资源图 | 表示数据单元和处理单元配置 |

## 五、支持的输出格式

| 格式 | 适用场景 |
|------|---------|
| Mermaid | 技术文档、GitHub/飞书/Notion 渲染 |
| SVG | 正式文档、打印，严格符合 GB 标准外观 |
| HTML | 浏览器展示、演示用途 |
