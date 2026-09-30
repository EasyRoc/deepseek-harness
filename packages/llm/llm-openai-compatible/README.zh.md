---
description: "面向第三方网关的 OpenAI 兼容 chat-completions 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-openai-compatible

[English](README.md) | 中文

## 概述

注册一条 OpenAI 兼容的 chat-completions 路由,支持流式、工具调用与用量统计。本插件面向讲 OpenAI 线上协议的网关——聚合中转、自托管服务与供应商兼容端点——并自持传输层;与 DeepSeek Messages 路由不共享代码。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

没有 `baseURL` 的行处于惰性状态:组合层可以挂载未配置的插件,后续补上 `baseURL` 的配置会激活该路由。`apiKeyEnv` 默认为 `OPENAI_COMPATIBLE_API_KEY` 并按请求解析——credentials 服务优先,只有未挂载该服务的组合才直接读取启动环境。凭据缺失以 `MISSING_CREDENTIAL` 失败。

```yaml
- id: llm-openai-compatible
  name: '@deepseek-ai/dsh-llm-openai-compatible'
  config:
    baseURL: https://gateway.example/v1
    provider: openai-compatible
    displayName: OpenAI Compatible
    models:
      - id: model-a
        contextWindow: 128000
```

`baseURL` 需包含版本路径,且必须是不含凭据、query、fragment 与尾部斜杠的 HTTP(S) 根;校验在加载期失败。`provider` 命名注册的路由,因此不同配置可以并排挂载多个网关。`models` 是建议性的选择器目录;当其为空且网关暴露 `/v1/models` 时,列表选择会以五分钟缓存从 listing 发现。`retryPolicy` 由提供方持有:[重试插件](../llm-retry/README.zh.md)按下列稳定失败码执行它。

状态分类遵循 OpenAI 契约并带一处刻意扩展:HTTP 402——one-api 系网关的余额耗尽信号——映射为终态 `QUOTA` 码且从不重试;403 将无效、禁用或范围受限的 key 标记为 `AUTH`。

<a id="understand-the-implementation"></a>
## 理解实现

适配器把中性会话语法序列化到 chat-completions 请求体,以空闲看门狗流式读取服务端事件,并在流结束时闭合每个打开的内容块。text 与 reasoning 块在另一类型开始时闭合,因此交错的工具调用保持首见块序;工具调用按线上 index 重组,并为省略 id 的网关合成 `call_<index>`。注册与 volatile-update 监听随插件释放;改变路由或重试策略的配置变更会原位替换注册。不发布 invariant 伴随物:适配器不持有组合所供注册之外的服务状态,且每条连接事实都按请求从配置重新解析。

<a id="further-exploration"></a>
## 进一步探索

[LLM streaming](../../../docs/subsystems/llm-streaming.zh.md) · [Adding an LLM adapter](../../../docs/cookbook/adding-an-llm-adapter.zh.md)

<a id="model-experience"></a>
## 模型体验

### OpenAI chat-completions 请求投影

#### What the model sees

请求把中性会话语法序列化到 OpenAI chat-completions 线上格式:system 与 developer 轮投影为 `system` 消息,工具结果投影为携带调用 id 的 `tool` 消息,assistant 工具调用投影为带原始 JSON 参数串的 `tool_calls`。每个请求都开启用量统计流式请求。

#### Token effect

数据相关:用量反映序列化后的会话;实际用量由所选模型与请求内容决定。

#### KV Cache effect

投影在每次请求发送完整工具声明列表与前置 system 轮,任一者在会话中途变化都会重写请求前缀;其余情况沿会话追加式增长。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅文本与工具** — image 与 file 块以 `INVALID_REQUEST` 使请求失败;附件投影推迟到出现需要的网关场景。
- **无原生 replay** — 响应不携带 `replayState`,后续调用重发普通历史;依赖响应 id 做 replay 的供应商不受支持。
- **developer 轮映射为 system 轮** — 线上格式把 developer 文本映射为 `system`,历史中的 reasoning 块被丢弃;跨网关可移植性优先于保留二者。

<a id="dev-note"></a>
### 开发备注

适配器覆盖测试基于环回 chat-completions 服务器;当环境存在可用 key 时,真实网关行为由仓库 e2e 通道覆盖。
