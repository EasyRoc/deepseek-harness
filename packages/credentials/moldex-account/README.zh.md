---
description: "Moldex 租户账户提供方:表单登录、JWT 刷新与密钥管理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-moldex-account

[English](README.md) | 中文

## 概述

为 Moldex 部署实现账户 Service Definition:专用 `moldexAccount` Remote 命名空间承载登录表单与密钥创建,account 命名空间暴露状态、资料与余额,存储的凭据从不跨越到 Client。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

`accountOrigin` 指向租户 API 与门户所在 origin(默认 `https://www.moldex.top`;生产环境租户 API 在门户源上,推理由 LLM provider 持有的独立网关主机承载)。`apiKeyEnv` 是创建的推理密钥写入的凭据引用名(默认 `MOLDEX_API_KEY`)。登录凭据按尝试经专用命名空间提交一次;密码从不持久化、记录或返回。access token 存活 24 小时,以单飞守卫做响应式刷新;刷新失败即过期登录并发出共享的会话过期通知。存储的 grant 记录签发 origin,配置 origin 变更时即被丢弃。

```yaml
- id: moldex-account
  name: '@deepseek-ai/dsh-moldex-account'
  config:
    accountOrigin: https://www.moldex.top
    apiKeyEnv: MOLDEX_API_KEY
```

bonus 操作返回契约的缺席结果:Moldex 没有促销 bonus 通知。`getPlatformSession` 恒为 null——Moldex 没有嵌入平台文档语义;`resolveToken` 恒为 undefined——推理使用凭据存储持有的租户 API key。

<a id="understand-the-implementation"></a>
## 理解实现

提供方继承共享的账户 Service Definition,因此 account Remote 命名空间与 Client 界面原样可用。登录尝试经凭据 key 的授权注册表流程仲裁;表单提交解除等待中的尝试,grant 经授权会话提交。过期只移除一次存储 grant,通知活跃订阅者,并让依赖读取渲染缺席。不发布 invariant 伴随物:提供方不持有凭据存储 grant 与内存中尝试之外的状态,二者均归其所组合的凭据与授权接缝所有。

<a id="further-exploration"></a>
## 进一步探索

[凭据子系统](../../../docs/subsystems/credentials.zh.md) 持有存储 API;[账户决策记录](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.zh.md) 记录共享契约继承的取消与存储归属。

<a id="model-experience"></a>
## 模型体验

None, as ` — 账户凭据只影响 HTTP 鉴权,从不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

模型请求前缀不变。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **仅响应式刷新** — token 在过期后的首个被拒请求时刷新,非主动刷新;空闲客户端在其下次操作时结算。
- **无服务端吊销** — Moldex 没有登出端点,登出即本地删除;泄漏的 refresh token 在七天有效期内仍然有效。
- **只能创建密钥** — 既有租户密钥无法再次读取明文(平台存 bcrypt 哈希),客户端创建专用密钥而非选择既有密钥。

<a id="dev-note"></a>
### 开发备注

租户 API 契约测试基于按生产信封建模的环回服务器;存在环境凭据时,真实网关往返由仓库 e2e 通道覆盖。
