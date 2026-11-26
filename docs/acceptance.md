# 动态头像验收映射

需求基线：自然提供的《动态头像需求文档》v1.0，2026-11-17。此表区分可重复的开发验证与依赖真实外部服务的操作，不以未发生的操作填验收结果。

| 需求 | 实现与验证 |
| --- | --- |
| 空闲 10 秒后处于 idle | 状态引擎会话结束归 idle；虚拟时钟测试空闲稳定，浏览器验证 idle 文案可空 |
| 对话切 working + 正在思考 | 宿主运行事件、agents 启动基线，浏览器 sessions store；状态与 HTTP 测试 |
| 浏览网页文案变化 | tool/call + classifyTool 映射；普通状态和文案共同防抖 |
| 子任务等待与自动回落 | 明确 wait_agent / job_output(wait:true) 触发；工具结果按 callId 清理；虚拟时钟测试 |
| 断网后 3 秒内 connecting | 本地 connection store / offline 立即切换；状态服务无响应时约 1.2 秒轮询 + 1.5 秒请求超时内响应；真正断网由连接 store 立即响应 |
| 目标完成庆祝再回落 | goal/change.operation=complete；不在 update_goal 调用尝试时提前庆祝；4 秒后重新计算当前工作 |
| 快速调用不抽搐 | 动画、文案共用最小展示 1500ms；过期中间状态不回放；连接变化绕过防抖 |
| 删除资产后默认兜底，恢复后自动重载 | 资产目录/肖像缺失测试；视频单独缺失保留已选主肖像，恢复后重读 |
| 深色变体 | video_dark / portrait_dark / poster_dark；浏览器真 H.264 解码与主题切换测试 |
| 点击打开等价状态面板 | 活动 / 外观 / 形象三页；面板几何不遮挡头像、拖动防误点击、Escape关闭 |
| 视频衔接 | 双 video 层，下一源 canplay 后淡入150ms；静音、playsInline；失败回静态 |
| 名称胶囊 | 名称独立固定，压头像下沿；工作文案位于下一行并截断，完整文案保留title |
| 多会话 | 归约多会话和并行工具，移除会话清工具；保留running计数 |
| 候选 → 用户选择 → 激活 | API + 浏览器测试预览不生效、确认才激活、重启恢复选择 |
| 换装 | 可选 Agnes restyle，保身份提示与参考图，产出仍进候选 |
| 主图后动画补齐 | 用户明确点击后入后台队列，独立从同一肖像生成每段，原子更新清单 |
| 跳舞彩蛋 | 用户按钮触发，本地临时覆盖持续跨宿主轮询，视频结束 / 10 秒回当前基础态 |
| 资源与生命周期 | 隐藏时暂停、减少动态禁视频播放、预加载限12段；dispose清计时器/订阅/媒体/HTTP流 |
| 资产清理 | reset回默认并清候选记录；不删除用户原始导入媒体，生成文件由受管生命周期清理 |

## 自动化入口

```bash
npm run build
npm run check
npm test
npm run test:browser
npm pack --dry-run
```

- `test/activity.test.mjs`：虚拟时钟状态机，覆盖优先级、防抖、并行、时间戳、临时态和清理。
- `test/assets.test.mjs`：清单校验、媒体索引、候选激活、持久化、缺失恢复、部分资产与路径处理。
- `test/host-smoke.mjs`：实际 Node HTTP server，验证配置、身份检查、同源写入、MP4 Range、事件适配和资源释放。
- `test/generation.test.mjs`：模拟 Agnes 响应，验证请求结构、提示英文化、逐段生成、错误/取消/显式重试与恢复。
- `test/browser.mjs`：Playwright 加载正式 ModuleLoader bundle，验证交互、视频播放与回退、主题、拖动、舞蹈和清理；不是录制真实 DSH 会话。

## 本轮验证记录

2026-11-17 最终构建与验证：`npm run build`、`npm run check`、`git diff --check` 全部通过。`npm test` 共 **74/74** 项通过（共享状态/资产/生成 59 项，宿主 HTTP 15 项）；`npm run test:browser` 共 **14/14** 组通过，包括生成表单、候选视频生命周期、恢复默认与深浅模式。完整本地日志为 `test-results/final-validation.log`，截图为 `test-results/buddy-light.png` 和 `test-results/buddy-dark.png`。

## 外部依赖记录

仓库原有 `assets/avatar.jpg` 作为默认肖像。Alice 原始状态视频未随需求提供；默认包以主肖像作各态兜底。Agnes 图像和视频 API 未在本轮消耗真实额度，生产管线通过模拟响应验证。视觉身份一致性的提示、参考图复用和独立生成已经落实，但最终人物相似度、生成视频是否携带声轨、服务耗时与费用仍需对实际素材验收；播放器始终强制静音。

本轮交付本地代码和可安装包。没有创建 git commit、push、PR，没有修改当前 DSH 安装或用户的已启用插件配置。实际安装选择本仓库后重新加载组件即可验证真实会话事件；安装步骤见 README。
