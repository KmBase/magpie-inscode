# 发布指南

把 `magpie-inscode` 发布成 npm 包，让用户 `magpie plugin add magpie-inscode` 就能装上。

## 前置

- Node 20+，且本机 `npm` 可用（打包与发布用 npm；magpie 运行时自带 Bun）。
- 已注册 npm 账号并登录（`npm login`）。

## 打包检查

```bash
# 跑一遍测试
node --test test/*.test.mjs

# 列出发布内容，确认只有预期文件
npm pack --dry-run
```

`package.json` 的 `files` 已圈定：`index.mjs` 及所有运行模块、`assets/`、`README*`、
`NOTICE.md`、`LICENSE`。`files` 外的（如 `test/`）不会被发布，所以补模块时要同步把它
加进 `files`。

## 发布

```bash
# 版本号：修复 → patch，新功能 → minor，破坏性/里程碑 → major
npm version patch
npm publish --access public
```

## 用户侧安装

```bash
magpie plugin add magpie-inscode        # 或 @magpie-community/…（见下）
magpie plugin login inscode             # 读取本机 InsCode 凭据
magpie provider test inscode            # 验证
```

## 上架到 magpie 社区（可选）

社区插件命名规范为 `@magpie-community/<kind>-<name>`，本插件可考虑
`@magpie-community/provider-inscode`。将 `package.json` 的 `name` 改为该命名后照常
发布即可；magpie 每启动后会自动更新社区包。请先在
[magpie-community/plugins](https://github.com/magpie-community/plugins) 了解上架流程。

## 注意事项

- 本插件是**非官方**实现，依据逆向/OAuth 观察写成。上游端点一旦变化可能失效，发布前请
  先用本机真实账号跑一次 OAuth 登录和 `magpie provider test inscode` 确认。
- 发布包不含任何真实密钥；`api_key` 通过 OAuth 会话绑定由 taotoken 返回，用户账号凭据
  始终留存在本机。
- 依赖保持为零，不要引入运行时第三方包（签名/OAuth 只需 `node:crypto` + 标准库）。