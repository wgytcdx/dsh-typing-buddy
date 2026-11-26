# dsh-typing-buddy

为 DSH 复刻 Muse 式动态头像：**圆形头肩像 + 压在下沿的名称胶囊 + 独立的一行状态文案**。支持静音循环视频、八态活动映射、深色资产、点击状态面板、拖动和外观设置，以及候选形象预览、确认激活与持久化恢复。

本版为 `0.2.0`，按 2026-11-17 的动态头像需求开发。默认带仓库原有主肖像和轻微呼吸效果，未附带 Alice 的原始 MP4；导入资产包或启用可选的 Agnes 生成服务后，即可使用各状态视频。视频失败始终回落静态图。

## 本地安装与开发

在 DSH 桌面版「插件 → 添加插件 → 本地目录」中选择此仓库，然后启用。仓库已包含预构建的 `lib/client.js`，安装使用不依赖本地开发工具。

```bash
npm ci
npm run build
npm run check
npm test
npm run test:browser
```

修改 `src/` 或共享的 `lib/activity.js` 后运行 `npm run build`。修改完成后在插件详情页关闭并重新开启组件，再刷新当前 DSH 页面。这里的客户端构建只更新此插件，不会启动另一个 DSH 服务。

浏览器测试使用 Playwright。默认使用已安装的 Playwright Chromium 或 Google Chrome；也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。没有可用浏览器时先执行 `npx playwright install chromium`。截图位于 `test-results/`，不进入发行包。

## 操作

- 点击头像或名称：打开活动 / 外观 / 形象面板；Escape 或点击外部关闭。
- 拖动头像：调整位置并记住；移动超过 5px 才算拖动，拖动结束不会误开面板。
- 右键头像：直接进入外观设置。名称始终独立显示，不随运行文案变化。
- 外观：调整名字、头像大小、胶囊边距、位置、主题、空闲问候和减少动态选项。浏览器设置覆盖插件配置，保存立即生效。
- 形象：导入资产包 JSON 或本机清单路径 → 预览各状态 → 确认激活。创建候选不会影响当前形象。换装使用同一确认流程。
- 跳舞：有舞蹈视频的资产包会显示「跳支舞」，播放完毕或最长 10 秒后回到当前状态。
- 恢复内置形象：清除本插件的选择与候选记录，保留用户导入的原始素材文件。

默认保持原插件的右上角位置，也可选择顶部居中。窄窗口默认缩至 80%；遵循系统减少动态设置，页面隐藏时暂停视频。

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
  "portrait_dark": "portrait-dark.webp",
  "states": {
    "idle": { "video": "idle.mp4", "video_dark": "idle-dark.mp4" },
    "working": { "video": "working.mp4", "video_dark": "working-dark.mp4" },
    "making_something": { "video": "making.mp4" },
    "waiting_for_subagents": { "video": "working.mp4" },
    "connecting": { "video": "idle.mp4" },
    "milestone_level_up": { "video": "celebrate.mp4" }
  },
  "dances": [{ "video": "dance.mp4", "video_dark": "dance-dark.mp4" }]
}
```

每状态支持 `video`、`video_dark`、`poster`、`poster_dark`。缺少深色视频时复用浅色视频；没有视频时用相应主题主图。`connecting` / `waiting_for_subagents` 可以复用 `idle` / `working`。`pending: true` 可供外部生产管线表示还在补齐；同一清单被更新后自动刷新，无须再次激活。

资产选择保存在 `~/.muse/dsh-typing-buddy/selection.json`。主肖像或清单暂时丢失时，保留选择并显示内置形象；原文件恢复后自动切回。仅视频缺失时保留选中主肖像。重建逻辑不会擅自重新发起收费 API 任务。

## 可选生成服务

使用 Agnes 的 `agnes-2.0-flash` 翻译生成提示，`agnes-image-2.1-flash` 生成 / 编辑主图，`agnes-video-v2.0` 从主图生成状态视频。默认关闭，不在安装或启动时消费额度。

1. 为运行 DSH 的宿主进程设置 `AGNES_API_KEY`（也支持 `AGNES_API_TOKEN` / `APIHUB_AGNES_API_KEY`）。密钥只保留在宿主环境，禁止放入资产清单。
2. 在插件配置中设置 `generationEnabled: true`，重新加载组件。
3. 形象面板输入一句话描述或参考照片 URL，点击明确标注 Agnes 的生成按钮，后台产生候选；换装默认以当前形象为参考。
4. 选择并激活主图后，点击「为已激活形象生成状态视频」。各状态从同一主肖像独立生成，避免以视频截图接力导致脸部漂移；`connecting` 与 `waiting` 复用视频。

进度和错误在面板显示，生成结果与任务记录保存在插件存储目录。重启后未完成任务标记中断，不自动重复收费；已完成素材保留。图像、视频生成使用模拟响应测试，本仓库没有把真实付费生成列入默认测试。

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
| `theme` | auto | auto / light / dark |
| `respectReducedMotion` | true | 遵循系统减少动态 |
| `compactOnNarrow` | true | 窄窗口缩小 |
| `draggable` | true | 拖动位置 |
| `desktopEnabled` / `beacon` | true | 兼容原桌面伴侣开关 / 本地 beacon |
| `generationEnabled` | false | 显式启用 Agnes 生成 |
| `storageDir` | 用户目录 | 高级选项，隔离选择、生成与状态存储，测试使用临时目录 |

旧 `textRunning` / `textMulti` 仍可自定义普通思考文案；工具活动使用相应短文案。`showKeyboardIcon` 作为旧配置兼容保留，Muse 布局不再把工作图标塞进名称胶囊。

## HTTP 与外部活动接口

所有路由继承当前 DSH 连接的认证并限制 owner；写操作还检查同源 JSON。没有硬编码的备用端口或跨域通配头。

| 路由（前缀 `/dsh-typing-buddy`） | 方法 | 内容 |
| --- | --- | --- |
| `/config.json` | GET | 公开配置（不包含本机私有路径或密钥） |
| `/avatar` | GET / HEAD | 兼容单图代理 |
| `/status.json` | GET | 完整活动快照与最近 30 条状态历史 |
| `/asset-pack.json` | GET | 当前公共资产表 |
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

核心状态、资产生命周期、真实 HTTP 及浏览器交互均有自动化测试。具体映射见 `docs/acceptance.md`。未接入真实付费生成、未拿到 Alice 原始头像视频的事实，与状态机和生产管线的开发测试分别记录；不把静态呼吸效果当作真人状态视频。

DSH 引擎范围为 `>=0.2.1-rc.2 <0.3.0-0`，实现按本机已安装 `0.2.1-rc.2` 的事件与连接服务核对。
