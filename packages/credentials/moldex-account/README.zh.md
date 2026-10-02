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

通过 profile patch 激活（示例见同目录 `moldex-profile.patch.example.yml`），不要改 `dsh-base` 的默认组合。Desktop 端到端：把示例 patch 合并进 `$DSH_HOME/profiles/desktop/cordis.patch.yml`（开发环境默认在 `apps/desktop/.desktop-build/development/home/profiles/desktop/`），执行 `pnpm --filter @deepseek-ai/dsh-client-ui-account-moldex bundle` 与 `pnpm run start:desktop`（或 `dev:desktop`）。`desktop` profile 只能由 Electron 启动，不能用 `pnpm dsh desktop --patch`。登录入口：侧边栏 **更多 → 登录**（弹出 Moldex 表单），或 **设置 → 模型**。登录成功后提供方会在尚无推理密钥时自动创建并写入 `apiKeyEnv`。

Patch 还应 **禁用 `llm-deepseek`**，否则 **设置 → 模型** 仍会出现 DeepSeek 官方路由。Moldex 推理只保留 **`llm-openai-compatible` 的 `provider: moldex`**；不要在 **`llm-pi-ai` 设置或 patch 里再挂一条 DeepSeek/`llm-pi-ai` 路由**（会与 Moldex 混用两套 Key，选择器也会出现两个 DeepSeek 来源）。示例把 `models` 留空，由网关 `/models` 发现列表；`agent-default-model` 指向你要的 wire id（例如 `glm-5.2`）。在 Moldex 路由上设置 **`requireAccountSession: true`**，未登录时推理以 `ACCOUNT_SIGN_IN_REQUIRED` 失败；登出或会话过期会清除 `MOLDEX_API_KEY`，避免未登录仍用残留密钥。

**品牌与窗口标题**：挂载 `@deepseek-ai/dsh-client-ui-account-moldex` 后，侧栏 `sidebar.brand.*` 显示 Moldex 标识。Desktop 发布构建使用 **`DSH_DESKTOP_CLIENT_BUILD_PROFILE=moldex`**（`pnpm run build:moldex`），窗口标题为 Moldex。安装包名称与 Dock 图标由 `apps/desktop/.env.macos` 中的 **`DSH_DESKTOP_PRODUCT_NAME`**、**`DSH_DESKTOP_MAC_ICON`** 配置；示例见 **`apps/desktop/.env.macos.moldex.example`**，图标源运行 **`pnpm --dir apps/desktop run render:moldex-icon`**。GitHub Release 使用 Actions 工作流 **`moldex-agent-desktop-release.yml`**（需仓库密钥 **`MOLDEX_MACOS_ENV_FILE`**，内容为完整 `.env.macos`）。

**同一 Moldex 路由下 DeepSeek 正常、GLM/Qwen 失败时**：示例 patch 设 **`streamUsage: false`**（部分上游不接受 `stream_options.include_usage`）。`llm-openai-compatible` 流式解析 **优先使用 `choices[].delta`**；若先读 `message` 再忽略 `delta`，GLM/Qwen 网关常因空 `message` 与有内容的 `delta` 同帧而收不到正文。修改 Host 后需 **`pnpm run build`** 再启 Desktop。

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
