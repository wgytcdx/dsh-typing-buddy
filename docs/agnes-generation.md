# 可选 Agnes 生成管线

默认关闭。宿主仅在 `generationEnabled: true` 且存在 API key 时启用服务；key 按 `AGNES_API_KEY`、`AGNES_API_TOKEN`、`APIHUB_AGNES_API_KEY` 顺序读取。公开配置、任务 snapshot 和错误消息均不含 key、原始文件路径或 provider 响应正文。

```js
import { createGenerationService, GenerationError } from "../lib/generation.js";

const generation = createGenerationService({
  store: assets,
  storageDir,
  enabled: generationEnabled,
  // apiKey 可由宿主私下传入；省略则读取环境变量。
  onChange(snapshot) {
    controller.setGenerating(snapshot.jobs.some((job) =>
      job.status === "queued" || job.status === "running"));
  },
});

// 同步校验、持久化并排队，不等待网络；HTTP 应返回 202。
const { id } = generation.start({
  mode: "create", prompt: "银发、水彩风的温柔女性", name: "我的头像", count: 3,
});
```

## 固定接口与宿主集成

- `snapshot()` 返回 `{available, models: {text,image,video}, jobs}`；持久化异常时附加固定文案 `error`。`available` 仅取决于启用开关和 key。
- `start(input)` 返回 `{id}`。`GenerationError.statusCode` 可用于 HTTP 状态码；无需向客户端输出异常堆栈。
- `onChange(snapshot)` 是可选扩展参数，排队、开始、逐片段成功、结束和取消时触发。回调异常由服务隔离。宿主初始化后应主动读取一次 snapshot。
- `await clear()` 取消运行和排队任务、等待动画收尾，再删除私有登记的 `storageDir/generated/<uuid>` 目录并清空任务/原图记录。清理过程中 `start` 返回 409；清理后仍可使用服务。宿主重置顺序为 `await generation.clear(); assets.reset();`，以清除已删除生成候选的引用。外部导入文件保持原样。
- `dispose()` 幂等取消并停止后续请求，用于插件卸载。卸载后 `start` 返回 503。

推荐宿主路由：`GET /dsh-typing-buddy/generation.json` 返回 snapshot；`POST /dsh-typing-buddy/generation` 接收 input 并返回 202。参考图 data URL 解码上限为 8 MiB，HTTP JSON 请求上限应至少为 12 MiB；路由继续使用宿主身份校验与同源校验。UI 可在 onChange 或轮询后刷新候选列表。

任务公开字段为 `id, mode, status, createdAt, updatedAt, progress:{completed,total}, candidateIds, retryable`，动画附带 `packId`，重试附带 `retryOf`。状态枚举为 `queued | running | completed | failed | cancelled | interrupted`；错误为 `{status,message}`。任务内部输入、英文提示词、provider 原图 URL 和清单路径仅保存在私有 `generation.json` 中，文件权限为 0600；任务最多保存 20 条。

## 三种模式

`create` 默认三个候选，`count` 只接受 1–3 的整数。每次请求只生成一张独立主肖像；PNG 图片与清单写入 `generated/<uuid>/portrait.png` 和 `manifest.json`；provider 返回 JPEG/WebP/GIF/AVIF 时按真实 MIME 使用对应扩展名，再调用 `store.preview({manifestPath})`，由用户激活。可传 `reference` 为参考图 data URL、公开 HTTPS 图片 URL、候选 ID 或 `active`；也可用 `candidateId` 指向已有候选。中文描述先用 `agnes-2.0-flash` 翻译为英文，再调用图片模型。

`restyle` 默认一个候选；参考图可以显式传入，也可通过 `candidateId` 或当前激活头像取得。重绘提示词明确保持人物身份。生成候选的 provider 原图 URL 只写服务私有记录，不注入资产 manifest。本机头像只通过 `store.resolveMedia(publicRef)` 或兼容的 `store.media(id)` 能力读取并转换为 data URL，HTTP 本机媒体代理地址不会发送给 Agnes。

`animate` 只接受已激活目标，`candidateId` 可以是对应生成候选 ID、当前 pack ID 或 `active`。对已激活的外部/内置包，服务复制受管清单、保留相同 pack ID 和原肖像，再把激活来源移到受管副本；外部原清单保持原样。每段视频都独立从同一主肖像开始：`idle`、`working`、`making_something`、`milestone_level_up`、`dancing` 共五段；`connecting` 复用 idle，`waiting_for_subagents` 复用 working，dances 列表复用 dancing。`generating` 只有静态 poster。可传 `dark: true` 额外生成五段深色主题视频，默认关闭。

动画清单先原子写入 `pending: true`，每完成一个片段即原子更新，成功、失败或取消后恢复 `pending: false`。已完成视频始终保留。所有视频提示词明确锁定参考人物脸部、可见眼睛和嘴、白背景、居中头肩、固定镜头、静音、无文字覆盖，working 不额外添加耳机或笔记本。

## 重试、超时与资源限制

串行后台队列每次只处理一个任务。重启时，原 `queued/running` 任务变成 `interrupted`，不自动调用付费 API。失败、中断或取消后，显式调用 `start({retryJobId: id})`；该调用复制原输入，保留已完成候选/片段进度。图片任务在首次付费请求前私下固化参考图，换装/新建重试继续使用同一人物，即使当前激活头像已切换。动画重试锁定最初的目标 pack；切换头像后应先重新激活原目标。重试不自动重复已登记为完成的视频片段。

单次 provider 请求和资源下载上限为两分钟，包含响应正文读取；每段视频从创建到轮询/下载另有二十分钟总上限。图片最大 8 MiB，视频最大 64 MiB，流式与 arrayBuffer 下载均检查上限。引用只接受支持的 base64 `data:image/...` 或公开 HTTPS URL；本机地址、带凭证 URL、file URL 和 HTTP URL被校验拦截，下载禁用重定向。

API 请求使用以下固定形状：

```json
{
  "model": "agnes-image-2.1-flash",
  "prompt": "English portrait prompt",
  "size": "1024x1024",
  "extra_body": {"image": [], "response_format": "url"}
}
```

图片 endpoint 为 `POST /v1/images/generations`，编辑时 `extra_body.image` 放一个参考图。

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "English motion prompt and identity constraints",
  "image": "the same main portrait URL or data URL",
  "mode": "ti2vid",
  "width": 768,
  "height": 768,
  "num_frames": 81,
  "frame_rate": 24
}
```

视频 endpoint 为 `POST /v1/videos`，然后 `GET /v1/videos/:id`。完成后依次提取 `video_url`、`url` 或 `remixed_from_video_id`；缺少结果 URL 或 provider 失败都记入 job error，不虚报完成。

## 验证范围

运行 `node --test test/generation.test.mjs`。测试注入 mock fetch，覆盖请求形状、英文化、预览不激活、每状态相同参考图、别名、深色视频、持久化恢复、失败重试、超时、取消、受管清理、资源大小和缺 key。本次实现没有调用真实付费 API，测试结果不代表 Agnes 实网验证。未来进行真实验证时，按 agnes-ai-generation 技能使用其 Python helper。
