# dsh-typing-buddy

DSH 悬浮小挂件：**头像 + 状态文字**，跟着会话运行状态自动切换。
默认贴右上角，头像在上、灰色文字胶囊在下；可拖动、可右键改配置。

> 同一套状态还可以驱动一个**桌面级悬浮窗**（DSH 窗口不在前台时浮现），那是可选的伴侣程序，
> 本插件只负责「网页内那一层」。两者通过本机 beacon（127.0.0.1:48620）与
> `~/.muse/dsh-status.json` 互通。

## 本地安装

桌面版 DSH 的 `desktop` profile 由 Electron 管理，请使用应用内的插件页面：

1. 打开「插件」→「添加插件」→「本地目录」。
2. 选择本地插件目录，例如 `~/.muse/typing-buddy`。
3. 安装完成后点击「立即启用」。

开发期间修改 `lib/index.js` 或 `lib/client.js` 后，在插件详情页关闭再打开一次组件即可重新加载。CLI 的其他 profile 不会替代桌面版安装流程。

启用后打开 DSH 的「设置」，进入「小鲸鱼悬浮窗」即可修改头像、名称、单任务/多任务状态文字、位置、尺寸和键盘图标。保存后当前窗口立即更新；挂件右键面板仍可作为快捷入口。

`cordis.patch.yml` 最小挂载行：

```yaml
- insert:
    - id: typing-buddy
      name: dsh-typing-buddy
      config:
        textIdle: "小鲸鱼"
        textRunning: "正在回复"
```

## 配置项

写进插件 `config:`（宿主热重载，改完即生效）：

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `avatar` | string | `""` | 头像：`https://…` 图片 URL，或本机绝对路径 `/Users/you/a.png`；空 = 内置头像 |
| `size` | number | `40` | 头像直径（px），16–128 |
| `pillPadding` | number | `8` | 状态文字胶囊内边距（px），2–24；水平内边距自动按 1.5 倍计算 |
| `position` | string | `top-right` | `top-right` / `top-center` / `top-left` / `bottom-right` / `bottom-left` |
| `offsetX` | number | `22` | 离边距（px） |
| `offsetY` | number | `74` | 离边距（px） |
| `textIdle` | string | `小鲸鱼` | 没有会话在跑时显示 |
| `textRunning` | string | `正在回复` | 有 1 个会话在跑 |
| `textMulti` | string | `正在回复·{n}` | 多于 1 个会话，`{n}` 替换成数量 |
| `showKeyboardIcon` | bool | `true` | 工作时是否显示小键盘图标 |
| `draggable` | bool | `true` | 是否允许拖动（位置记在浏览器本地） |
| `compactOnNarrow` | bool | `true` | 窗口宽度 < 640px 时自动缩到 80% |

## 右键面板（不改文件也能调）

在挂件上**右键**，弹出小面板：头像 URL、头像尺寸、文字框内边距、位置、名称和三种状态文案，保存后写进
`localStorage`（键 `dsh-typing-buddy.config`），优先于插件 config；
「恢复默认」会清掉本地覆盖并刷新页面。

## 状态从哪来

浏览器半区读 `ctx.sessions.list` 的快照，叠加 `ctx.remote.$on("api-session/status")`
事件，另有 1.2s 轮询兜底。**不是扒 DOM**，聊天区改版不影响它。

宿主半区同时把状态写到 `~/.muse/dsh-status.json`（`{running, ids, ts, pid}`），
给桌面悬浮窗之类的外部程序读。

## 路由

- `GET /dsh-typing-buddy/config.json` —— 归一化后的配置（含 `avatarKind` / `avatarUrl`）
- `GET /dsh-typing-buddy/avatar` —— 当 `avatar` 是本机路径时，把文件代理给页面

## 卸载

在 DSH「插件」页面打开 `dsh-typing-buddy` 详情，点击「卸载」。

## 公共市场要求

包内已包含市场检查所需的基本结构：`dsh.bundle.patch`、同目录 `cordis.patch.yml`、`icon.svg`、版本与 DSH 引擎约束、可运行的 `apply()` 和宿主冒烟测试。

公开仓库地址已写入 `package.json`。提交到公共市场前还需要给仓库声明 `dsh-plugin` topic，发布可安装的 npm 包或 GitHub Release 压缩包，并在 `awesome-dsh-plugin` 仓库的 `data/plugins/<owner>__<repo>.yml` 添加条目后提交 PR。

## 兼容性

- DSH 0.2.x（当前开发环境为 0.2.1-rc.2，cordis 客户端插件图，`dsh.client` + `window.__ModuleLoader__`）
- 浏览器半区用到的服务：`sessions`、`remote`；宿主半区用到：`webServer`（缺失时只不挂载 HTTP 路由）
