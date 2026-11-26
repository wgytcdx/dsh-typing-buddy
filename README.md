# dsh-typing-buddy

为 DeepSeek Harness（DSH）添加动态头像挂件。头像下方显示独立的名称和状态文案，跟随会话、工具和后台任务切换八种状态。支持静音视频、拖动、外观设置、活动历史及候选形象预览与激活。

默认使用内置静态肖像。导入带 MP4 的资产包后可以播放各状态视频，视频不可用时回到静态图。

## 本地安装与开发

桌面版在「插件 → 添加插件 → 本地目录」选择此仓库并启用。Web 版可在已有的 `web` profile 使用预构建包：

```bash
npm pack --ignore-scripts
dsh plugin --profile web add ./dsh-typing-buddy-0.2.0.tgz
dsh --profile web
```

仓库包含预构建的 `lib/client.js`。使用 GitHub 来源安装时，从插件详情或发行记录选择已验证的提交 SHA。开发者修改源码后使用以下命令重新构建和检查：

```bash
npm ci
npm run build
npm run check
npm test
npm run test:browser
```

修改 `src/` 或共享的 `lib/activity.js` 后运行 `npm run build`。修改完成后在插件详情页关闭并重新开启组件，再刷新当前 DSH 页面。这里的客户端构建只更新此插件，不会启动另一个 DSH 服务。

浏览器测试使用 Playwright。默认使用已安装的 Playwright Chromium 或 Google Chrome；也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。没有可用浏览器时先执行 `npx playwright install chromium`。截图位于 `test-results/`，不进入发行包。

卸载时，在桌面插件详情选择「卸载」，或在 Web profile 执行 `dsh plugin --profile web remove dsh-typing-buddy`。

## 操作

- 点击头像或名称：打开活动 / 外观 / 形象面板；Escape 或点击外部关闭。
- 拖动头像：调整位置并记住；移动超过 5px 才算拖动，拖动结束不会误开面板。
- 右键头像：直接进入外观设置。名称始终独立显示，不随运行文案变化。
- 外观：调整名字、头像大小、胶囊边距、位置、主题、空闲问候和减少动态选项。浏览器设置覆盖插件配置，保存立即生效。
- 形象：导入资产包 JSON 或本机清单路径 → 预览各状态 → 确认激活。创建候选不会影响当前形象。换装使用同一确认流程。
- 跳舞：有舞蹈视频的资产包会显示「跳支舞」，播放完毕或最长 10 秒后回到当前状态。
- 恢复内置形象：清除本插件的选择与候选记录，保留用户导入的原始素材文件。

默认置于右上角，窄窗口缩至 80%。页面隐藏时暂停视频，并可跟随系统的减少动态设置。浅色和深色主题共用同一套头像与视频。

## 活动映射

| 状态 | 活动来源 | 默认文案 |
| --- | --- | --- |
| `idle` | 没有任务、工具或后台工作 | 空，可配置问候 |
| `working` | 模型运行、检索、读取文件、命令执行 | 正在思考 / 翻阅网站 / 在翻文件 / 运行命令 |
| `making_something` | 写入、编辑、构建产出物 | 在整理文档 / 正在制作 |
| `waiting_for_subagents` | 明确等待，如 `wait_agent`、`job_output(wait:true)` | 等结果回来 |
| `connecting` | DSH 连接丢失、离线、状态服务不可用 | 重新连接 |
| `milestone_level_up` | 新的目标完成事件 | 搞定啦 |
| `dancing` | 用户点跳舞或显式活动事件 | 跳支舞 |
| `generating` | 当前形象资产补齐 / 恢复中，且没有更高优先活动 | 生成中 |

状态优先级为：连接异常 → 庆祝 → 跳舞 → 制作 → 等待 → 工作 → 空闲时的生成占位 → 空闲。普通动画和文案最短展示 1500ms；连接断开及恢复立即切换。庆祝默认 4 秒，结束后重新计算当前活动，避免回到已经完成的旧任务。派出子任务本身仍是工作，只有实际等待才进入等待态。

宿主监听真实的 `api-session/status`、`session/event`，将 `tool/call`、`tool/result`、PTC 嵌套调用、`job/registered`、`job/settled`、`goal/change` 归约成全局活动。浏览器使用 `sessions.list` 与 `connection.state`，每 1.2 秒拉取一次宿主快照，资产清单每 10 秒刷新。宿主每 2 秒重读资产引用。浏览器不会为头像打开所有历史会话，也不依赖 DOM 文本识别。

## 资产包

本机清单中媒体路径以清单目录为基准。HTTP(S) 媒体可直接引用；本机媒体通过插件的受鉴权路由按引用索引提供，浏览器清单不暴露真实文件路径。建议 MP4 使用 H.264、无声、3–5 秒、较小分辨率与体积。

```json
{
  "id": "whale-v1",
  "name": "小鲸鱼 · 晨光",
  "portrait": "portrait.webp",
  "states": {
    "idle": { "video": "idle.mp4" },
    "working": { "video": "working.mp4" },
    "making_something": { "video": "making.mp4" },
    "waiting_for_subagents": { "video": "working.mp4" },
    "connecting": { "video": "idle.mp4" },
    "milestone_level_up": { "video": "celebrate.mp4" }
  },
  "dances": [{ "video": "dance.mp4" }]
}
```

每个状态支持 `video` 和 `poster`，缺少对应资源时使用主肖像。当前版本忽略旧清单中的 `*_dark` 媒体字段。`connecting` 和 `waiting_for_subagents` 可以复用 `idle` 和 `working` 的视频。外部程序可以用 `pending: true` 标记资产制作进度。插件会重新读取已激活的清单。

资产选择保存在 `~/.muse/dsh-typing-buddy/selection.json`。主肖像或清单暂时丢失时，保留选择并显示内置形象；原文件恢复后自动切回。仅视频缺失时保留选中主肖像。重建逻辑不会擅自重新发起收费 API 任务。

## 可选生成服务

宿主提供可选的 Agnes 生成 API。先在宿主环境中设置 `AGNES_API_KEY`，再显式启用 `generationEnabled`。当前形象面板用于导入、预览和激活，生成、换装和重试由已认证的 owner 调用宿主 API。

请求生成时，宿主会把生成描述和所选参考图发送给 Agnes，可能消耗账户额度。安装和启动不发起生成请求。重启后，未完成的任务会标记为中断，用户可显式重试。接口、环境变量别名与存储位置见 [Agnes 生成 API](docs/agnes-generation.md)。

## 插件配置

配置入口为 `cordis.patch.yml` 或 DSH 插件配置；外观面板的本地覆盖键仍为 `dsh-typing-buddy.config`，拖动位置为 `dsh-typing-buddy.pos`。旧版 `textIdle` 自动迁移为名称。

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | 小鲸鱼 | 名称胶囊 |
| `avatar` | 空 | 兼容旧版单图 URL / 本机路径 |
| `assetPack` | 空 | 本机 JSON 清单路径；空使用内置包 |
| `size` | 110 | 头像直径，16–256px |
| `pillPadding` | 6 | 名称胶囊内边距，2–24px |
| `position` | top-right | 另支持 top-center / top-left / bottom-right / bottom-left |
| `offsetX` / `offsetY` | 22 / 74 | 边距 |
| `idleLabel` | 空 | 空闲文案 |
| `minStateDuration` | 1500 | 最小展示毫秒，可设 0 |
| `theme` | auto | auto / light / dark，调整界面配色 |
| `respectReducedMotion` | true | 遵循系统减少动态 |
| `compactOnNarrow` | true | 窄窗口缩小 |
| `draggable` | true | 拖动位置 |
| `desktopEnabled` / `beacon` | true | 兼容原桌面伴侣开关 / 本地 beacon |
| `generationEnabled` | false | 显式启用 Agnes 生成 |
| `storageDir` | 用户目录 | 高级选项，隔离选择、生成与状态存储，测试使用临时目录 |

旧 `textRunning` 和 `textMulti` 用于同步独立桌面伴侣的工作文案。DSH 内部状态文案由活动类型决定。

## HTTP 与外部活动接口

所有路由继承当前 DSH 连接的认证并限制 owner；写操作还检查同源 JSON。没有硬编码的备用端口或跨域通配头。

| 路由（前缀 `/dsh-typing-buddy`） | 方法 | 内容 |
| --- | --- | --- |
| `/config.json` | GET | 公开配置（不包含本机私有路径或密钥） |
| `/avatar` | GET / HEAD | 兼容单图代理 |
| `/status.json` | GET | 完整活动快照与最近 30 条状态历史 |
| `/asset-pack.json` | GET | 当前公共资产表 |
| `/form-state.json` / `/form-state` | GET / POST | 读取或保存形象导入草稿 |
| `/packs` | GET | 当前资产、候选与恢复情况 |
| `/packs/preview` | POST | `{manifest}` 或 `{manifestPath}`，仅创建候选 |
| `/packs/activate` | POST | `{id}`，确认激活 |
| `/packs/reset` | POST | 恢复内置选择 |
| `/media/<id>` | GET / HEAD | 已登记的媒体，支持 MP4 Range 206 / 416 |
| `/generation.json` | GET | 服务可用性、模型与任务进度 |
| `/generation` | POST | `{mode,prompt,reference?,candidateId?,count?}`，加入后台生成队列 |

其他宿主组件可显式发送短期活动：

```js
ctx.emit('dsh-typing-buddy/activity', {
  type: 'activity', state: 'working', detail: 'web_browsing',
  label: '翻阅网站', sessionId: 'session-id', ts: Date.now(), durationMs: 15000,
});
```

支持 Unix 秒或毫秒时间戳。外部普通活动默认 15 秒租约，避免发送者退出后头像永久卡住；会话结束也会清理该会话活动。桌面状态仍写入 `~/.muse/dsh-status.json`，保留旧 `running / ids / ts / pid` 并增加 state / detail / label 等字段。独立桌面窗口程序不在本仓库；本版保留原来的 `127.0.0.1:48620` 同步协议，并增加状态与文案。

## 验收与边界

DSH 引擎范围为 `>=0.2.1-rc.2 <0.3.0-0`。在 DSH `0.2.1-rc.2` 与 Node.js 22 上验证了压缩包安装和 Web 冷启动。测试范围见 [验收说明](docs/acceptance.md)。
