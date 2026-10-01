---
description: "面向桌面渲染器的 Moldex 登录表单与账户呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-moldex

[English](README.md) | 中文

## 概述

以遮蔽优先级将 Moldex 登录表单注册进设置的登录槽位,在 Moldex 组合中替换浏览器跳转式引导。组件渲染账户状态流的尝试阶段,并按尝试经专用 Moldex 命名空间提交凭据。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

本包只在桌面渲染器挂载,并期望 Moldex 组合:宿主账户提供方、其命名空间的中央 Remote 挂载,以及创建密钥所喂给的 LLM 路由。文案由本包的 locale 字典持有,经 locale seat 到达组件。

<a id="understand-the-implementation"></a>
## 理解实现

apply 闭包把账户状态流订阅进注入面快照,并暴露 start 与 submit 回调;组件只在本地保存输入值。提交失败经注入的 error 字段与宿主发布的尝试阶段呈现。不发布 invariant 伴随物:本包不持有 slot 渲染之外的运行时状态,快照由 apply 闭包持有。

<a id="further-exploration"></a>
## 进一步探索

[Moldex 账户提供方](../../credentials/moldex-account/README.zh.md) 持有本表单驱动的登录、刷新与密钥语义。

<a id="model-experience"></a>
## 模型体验

None, as ` — 表单驱动的账户 HTTP 调用从不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

模型请求前缀不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅桌面渲染器** — web 组合保留基础组合自带的提供方引导。
