# magpie-inscode

把 **CSDN InsCode 免费额度**作为一个供应商接入 [magpie](https://usemagpie.ai)（也兼容 OpenCode）。

登录采用**浏览器 OAuth**：插件打开 `https://taotoken.net/oauth?sid=<uuid>`，你授权后
页面会把会话绑定到账号，插件从 *complete* 端点领取凭据并用其中的 `api_key` 请求；
聊天请求走网关 `https://taotoken.net/api/v1`，Bearer key 之外还要带 **`X-Tt` 客户端
签名**（见下文）。于是 `inscode/deepseek-v4-flash` 就变成任何 agent 都能直接选的
OpenAI 兼容供应商。

> 对应 [`inscode2api`](https://github.com/HPPC114514/inscode2api)（一个把 InsCode 额度变成
> 本地 OpenAI 接口的零依赖代理）的接入事实；本插件在 magpie 的插件宿主里做了等价
> 的事——不需要再额外跑一个代理进程。

## 安装

在 magpie 界面里 **插件 → 添加插件 → 填文件夹路径**，或命令行：

```bash
magpie plugin add ./magpie-inscode   # 本地文件夹就地加载，不安装任何依赖
```

然后登录并试用：

```bash
magpie plugin login inscode           # 打开浏览器 OAuth 登录
magpie plugin                         # inscode (InsCode, N models) signed in
magpie provider test inscode          # ✓ chat  …ms · deepseek-v4-flash
magpie quota                          # inscode · InsCode 免费套餐 · …
```

之后就能和别的供应商一样用 `inscode/<model>`。

## 怎么登录

主要登录方式是**浏览器 OAuth**（按 sid 绑定会话）：插件打开
`https://taotoken.net/oauth?sid=<uuid>`，你在授权页登录后，页面会把该会话绑定到
你的账号。授权页完成后会深链到 InsCode 桌面版（`inscode://auth/callback`），插件
读不到浏览器；所以插件改去轮询应用侧端点
`POST https://api.taotoken.net/v1/codex/session/<sid>/complete?deviceId=<id>`
（无需登录态，带 `X-Tt-Device-Id` 头），直到返回 `SUCCESS` 并取出 `apiKey`。领取是幂等
的，桌面版同时领取同一个会话也不会冲突。

| 登录方式 | 过程 |
|---|---|
| 浏览器 OAuth（默认） | 打开 `…/oauth?sid=…`，轮询 `…/codex/session/<sid>/complete` 取 `apiKey` |
| 本机凭据（备选） | 直接读 `~/.config/inscode/{taotoken,device,auth}.json` |

所有值只在本机使用，仅作为 `Authorization` 和 `X-Tt-*` 签名头发给 taotoken 网关。

## 请求怎么签名

聊天 POST 请求在 Bearer key 之外还要带 **`X-Tt` 客户端签名**——只带
`Authorization` 会被网关拒绝 `401 invalid_client_signature`。算法来自 InsCode
客户端、已在真实网关验证（实现见 `sign.mjs`）：

- HMAC 密钥：账号 `sign_key` 的值 **base64 解码**后（32 字节原始密钥）；
- canonical 串：`POST\n{path}\n{ts_ms}\n{nonce_b64}\n{key_id}\n{sha256_hex(body)}`；
- `X-Tt-Sign` = HMAC-SHA256 的 hex，连同 `X-Tt-Keyid`、`X-Tt-Ts`（epoch 毫秒）、
  `X-Tt-Nonce`、`X-Tt-Sign-Version: v1`、`X-Tt-Device-Id` 一起发送。

`GET` 端点（如 `/v1/models`）**纯 Bearer**、不签名。`loader.baseURL` 设为
`https://taotoken.net/api/v1`，AI SDK 包用 `@ai-sdk/openai-compatible`，于是
chat-completions 请求落在 `https://taotoken.net/api/v1/chat/completions`——
这正是签名算法验证过的 host+path 组合。本次改动之前登录的账号会自动开始签名：
登录快照里的 `signKey`（备选登录则读本机 `taotoken.json`）每次请求都会读取，
无需重新登录。

## magpie 原生钩子

- **`auth.usage`**（`quota.mjs`）——只上报一个 5 小时窗口（日常真正卡额度的那个），
  数据来自 `codingPlan.buckets`；登录的 `sid` 会保存下来，`usage` 会定期（受
  `quotaTtlMs` 节流）重 poll 幂等的 session-complete 端点刷新，登录之后才出现的桶
  也能显示。周/月桶直接丢弃，保持额度行简短。绑定响应没带 buckets 时，回退读本机
  InsCode 客户端的 `taotoken.json`（浏览器 OAuth 登录的账号也一样），只要记录里有
  `used`/`limit` 就会显示 5 小时额度窗口；实在没有就给一行 plan 加空窗口列表。
  显示在 **magpie quota** 和账号那一行。
- **`auth.checkin`**（`checkin.mjs`）——每日签到领额度。taotoken 的签到端点
  **尚未验证**，所以只有你设置 `INCODE2API_CHECKIN_URL`（POST、Bearer 鉴权）时才
  真正签到；否则返回 `inactive`——不重试、不误报。
- **`auth.refresh`**——对 `api_key` 来说不需要：登录时已保存；额度 buckets 则由
  `auth.usage` 内部重 poll session-complete 端点刷新。

## 每个账号的模型

在账号作用域里用 `GET /v1/models`（纯 Bearer）拉取该账号可用模型，叠加到静态
列表上——低档套餐的账号只会看到它真正拥有的模型。

## 文件

```
index.mjs    插件入口：config、auth（methods/loader/usage/checkin）、provider
internal.mjs PROVIDER id、DEFAULT_API_BASE、内联图标、共享辅助
oauth.mjs    浏览器 OAuth：sid、授权 URL、会话完成轮询
sign.mjs     聊天 POST 的 X-Tt 客户端签名
creds.mjs    读取并解析本机 InsCode 凭据文件（备选登录）
models.mjs   模型 fallback、规范化、按账号目录
quota.mjs    免费额度 → auth.usage 映射
checkin.mjs  每日签到钩子（可选开启）
i18n.mjs     zh/en UI 文案
assets/      供应商图标（加载时内联）
test/        `node --test` 单元测试（sign/quota/i18n/models/creds）
```

## 选项

插件入口接受可选的 `options` 参数
（`magpie plugin options <name> '{"locale":"zh", …}'`）：

| 选项 | 默认 | 含义 |
|---|---|---|
| `locale` | `auto` | `"zh"`、`"en"`，或跟随系统。 |
| `apiBase` | `https://taotoken.net/api/v1` | 覆盖 taotoken 网关底座。 |
| `deviceId` | 桌面版的 `device_id` | 发给会话完成端点的设备 ID。 |
| `modelsTtlMs` | `600000` | 单个账号模型列表的缓存时长。 |
| `maxOutputTokens` | `8192` | 无输出窗口的模型缺省输出长度。 |
| `quotaTtlMs` | `60000` | 每个账号 `usage` 结果的缓存时长。 |

## 测试

```bash
node --test test/*.test.mjs     # 52 个单元测试
npm test                        # 同上
```

## 安全说明

- 凭据只在插件宿主进程里用于和 taotoken.net 通信，绝不写日志、绝不发往其他地方。
- 建议在本机运行 magpie / agent。因为插件直接复用你的 InsCode 登录，**不要**把该
  供应商的请求暴露到不可信网络或多个用户共用的网关上，以免烧掉你的免费额度。
- `sign_key` 有 `expire_at`，会过期。本机凭据登录的账号每次请求从磁盘重读，能自动
  拿到新密钥，重启 InsCode 客户端刷新凭据即可；OAuth 登录的账号签名材料来自登录
  快照，`sign_key` 轮换后上游开始回 `401 invalid_client_signature` 时需要重新登录。

## 局限

- `auth.usage` 与 `auth.checkin` 在确认 taotoken 额度和签到端点前是尽力而为的；
  聊天与模型不受影响。
- 只接入了主免费账号；多账号 / `pros` 套餐暂未按独立账号暴露。

## License

MIT