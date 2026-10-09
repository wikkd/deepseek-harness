#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
flowchart-designer — LM Studio API 调用示例
依赖：requests（pip install requests）
前提：LM Studio 已启动并加载模型，默认监听 http://localhost:1234
"""

import requests
import json
import os

# ── 配置区 ──────────────────────────────────────────────
LMSTUDIO_BASE_URL = "http://localhost:1234"
MODEL_NAME = "qwen/qwen3.5-9b"   # 换成你 LM Studio 实际加载的模型名
SYSTEM_PROMPT_FILE = os.path.join(
    os.path.dirname(__file__), "system_prompt_mini.md"
)
# ────────────────────────────────────────────────────────


def load_system_prompt(filepath: str) -> str:
    """读取 System Prompt 文件"""
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


def draw_flowchart(user_request: str, system_prompt: str) -> str:
    """调用 LM Studio 本地 API 生成流程图"""
    url = f"{LMSTUDIO_BASE_URL}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_request},
        ],
        "temperature": 0.3,   # 降低随机性，输出更规范
        "max_tokens": 2048,
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except requests.exceptions.ConnectionError:
        return "[错误] 无法连接 LM Studio，请确认服务已启动（端口 1234）"
    except requests.exceptions.Timeout:
        return "[错误] 请求超时，模型响应过慢，可尝试缩短请求内容"
    except Exception as e:
        return f"[错误] {e}"


def main():
    # 加载 System Prompt
    if not os.path.exists(SYSTEM_PROMPT_FILE):
        print(f"[警告] 未找到 {SYSTEM_PROMPT_FILE}，使用内置最小化 prompt")
        system_prompt = (
            "你是一个按照 GB 1526-89 国家标准绘制流程图的助手。"
            "默认输出 Mermaid 格式，判断节点所有出口必须标注条件值。"
        )
    else:
        system_prompt = load_system_prompt(SYSTEM_PROMPT_FILE)
        print(f"[OK] 已加载 System Prompt（{len(system_prompt)} 字符）")

    # 示例请求列表
    examples = [
        "帮我画一个用户登录验证的程序流程图，包含用户名和密码校验，失败3次锁定账户。",
        "画一个文件上传处理的数据流程图，包括格式检查、病毒扫描和存储步骤。",
        "画一个电商下单流程图，包含库存检查、支付、发货环节，要求用 SVG 格式输出。",
    ]

    print("\n选择示例请求：")
    for i, ex in enumerate(examples, 1):
        print(f"  {i}. {ex[:50]}...")
    print("  0. 自定义输入")

    choice = input("\n请输入编号（0-3）：").strip()
    if choice in ("1", "2", "3"):
        user_request = examples[int(choice) - 1]
    else:
        user_request = input("请输入你的流程图需求：").strip()

    if not user_request:
        print("[提示] 未输入内容，退出")
        return

    print(f"\n[请求] {user_request[:80]}...")
    print("[等待] 模型生成中（最长等待 120 秒）...\n")

    result = draw_flowchart(user_request, system_prompt)

    print("=" * 60)
    print(result)
    print("=" * 60)

    # 可选：保存输出到文件
    save = input("\n是否保存输出到 output.md？(y/N) ").strip().lower()
    if save == "y":
        with open("output.md", "w", encoding="utf-8") as f:
            f.write(f"# 流程图输出\n\n**需求**：{user_request}\n\n---\n\n{result}")
        print("[OK] 已保存到 output.md")


if __name__ == "__main__":
    main()
