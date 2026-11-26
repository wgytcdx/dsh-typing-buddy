# 公共插件目录收录

[DSH 组合包发布指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md) 说明插件如何安装。社区目录 [awesome-dsh-plugin 的收录指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 说明如何提交收录条目。

| 检查 | 项目约定 |
| --- | --- |
| 仓库 | 公开仓库 `wgytcdx/dsh-typing-buddy`，带 `dsh-plugin` 主题 |
| 入口 | 根 `package.json` 中的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，patch 以包名挂载 `typing-buddy` |
| Web 客户端 | `dsh.client.platform: web`，依赖以 DSH 客户端服务标识声明。宿主代码只使用 Node 内置模块与包内模块 |
| 分发 | 提交预构建的 `lib/client.js`。Git 安装固定 commit，压缩包安装使用 `npm pack --ignore-scripts`。两种方式都使用同一份运行代码 |
| 运行环境 | DSH `0.2.1-rc.2` 和 Node.js 22 是实测版本，安装器按 `engines.dsh` 校验兼容范围 |
| 权限和网络 | HTTP 路由沿用 DSH owner 认证，写入检查同源。用户指定的在线媒体由浏览器读取。可选 Agnes API 默认关闭，调用时发送生成输入和所选参考图。桌面伴侣同步只访问本机回环地址 |
| 市场条目 | `ui` 分类，提供中英文功能描述和隔离 DSH 的外观截图。可选的独立桌面伴侣不属于该插件包 |

发布前在干净 checkout 运行 `npm ci`、`npm run build`、`npm run check`、`npm test` 和 `npm run test:browser`。构建后 `git diff --exit-code -- lib/client.js` 应通过。用 `npm pack --ignore-scripts` 生成包，并用独立 DSH Web profile 验证安装、首次加载与卸载。

公开仓库默认分支更新后，将 [条目 YAML](market/wgytcdx__dsh-typing-buddy.yml) 放到目录仓库的 `data/plugins/wgytcdx__dsh-typing-buddy.yml`，以单文件 PR 提交。目录维护者审核后收录。npm 发布可选。
