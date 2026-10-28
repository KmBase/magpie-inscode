# NOTICE / 署名

本插件的实现依据（只参考事实与算法，不复制代码）：

- **[inscode2api](https://github.com/HPPC114514/inscode2api)** — 与 taotoken 交互的确凿事实来源。
  `config.py` 记录了本机凭据文件（`taotoken.json` / `device.json` / `auth.json`）的字段结构；
  `signer.py` 记录了 `X-Tt` 客户端签名算法（作者对 InsCode 客户端静态逆向 + 二进制补丁
  抓包反推、并在真实上游验证通过）。本插件部分移植了其账号/端点事实：登录用浏览器
  OAuth（`taotoken.net/oauth?sid=<uuid>`，随后按 sid 轮询
  `api.taotoken.net/v1/codex/session/<sid>/complete?deviceId=…` 领取凭据）；模型/聊天
  请求走网关，其中聊天 POST 带 `X-Tt` 客户端签名（`sign.mjs`，算法与其 `signer.py`
  一致），`GET /models` 纯 Bearer。
- **[magpie-atomcode](https://github.com/…/magpie-atomcode) / magpie-sensenova** — MIT,
  aqiu817。同作者的 magpie 插件工程范式（单函数入口、i18n 表、`_internal` 测试出口、
  quota/模型缓存策略、NOTICE 约定）参考对象。

## 免责声明

本插件是非官方的兼容实现，不隶属于 CSDN / InsCode / taotoken，也未获其认可。
上游协议（OAuth 绑定、凭据格式、网关端点）可能随时变化导致不可用；使用方式也可能违反
服务条款，存在账号受限或封禁的风险。请仅凭自己的账号、在了解风险的前提下使用。