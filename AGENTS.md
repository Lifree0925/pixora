<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

> 本文件是项目级 Agent 规则。顶部 `<!-- BEGIN:nextjs-agent-rules -->` 到 `<!-- END:nextjs-agent-rules -->` 由 `next dev` 自动维护；项目规则写在托管块之后。

- 文档版本：1.1
- 最后更新：2026-11-17

## 1. 项目身份

你是本项目的资深全栈工程师。你的任务是实现一个仅供个人本机使用的 AI 图片创作 Web 应用。

本项目采用 Docker 本地部署，当前接入一阶 API 的 **GPT Image 2.0、GPT Image 2.5 Flare、GPT Image 2.5 Sunburst 和 Gemini Nano Banana 2.1**。不要擅自增加其他模型、支付、积分或公开用户系统。

MVP 默认仅监听 `127.0.0.1`，不开放局域网或公网访问。若后续需要远程访问，必须单独立项增加单用户口令、会话和文件访问控制。

## 2. 项目目标

实现以下核心能力：

1. 文生图。
2. 单图编辑。
3. 多张参考图编辑/融合。
4. 分辨率/画幅选择（只展示上游已确认支持的选项）。
5. 历史任务、图片预览、下载、基于历史结果再次编辑。
6. 历史分页、任务删除和只读系统状态。

界面采用现代简约风格，交互参考 ChatGPT：清晰、留白、低干扰、响应式布局。

## 3. 技术决策

除非用户明确要求变更，不要自行替换以下技术：

- 前端与服务端：Next.js App Router + TypeScript（模块化单体）。
- UI：Tailwind CSS + shadcn/ui。
- 数据库：PostgreSQL。
- ORM：Prisma。
- 图片存储：模式 A，参考图使用 Supabase Storage（私有 bucket、服务端 `SUPABASE_SERVICE_ROLE_KEY`、短期 HTTPS 签名 URL）。S3 兼容存储和本机磁盘保留为可选扩展；存储未配置时编辑功能必须禁用并明确提示。
- 部署：Docker Compose。
- 任务执行：独立 Node.js worker 进程负责异步提交和轮询；任务状态保存到 PostgreSQL。第一版不引入 Redis/BullMQ，不要过早增加基础设施。
- 模型抽象：模型定义集中在 `src/modules/models/registry.ts`，Provider 工厂在 `src/providers/index.ts`。前端只渲染 registry 声明的参数，服务端必须校验并拒绝未登记参数。
- 图片处理：sharp + file-type。
- 测试：Vitest + MSW + Playwright。
- 包管理：pnpm + lockfile。
- 所有 API Route 使用 Node.js runtime；Next.js 使用 standalone 构建。

## 4. 一阶 API 契约与待验证假设

以下内容来自一阶 Apifox 文档声明。Phase 0.5 真实接口验证完成前，接口字段、状态、输出格式和限制均视为待验证假设。

基础地址：`https://yijieapi.com`

当前 registry 模型：

| 内部 ID | 上游公开名 | 说明 |
| --- | --- | --- |
| `gr-gpt-image-2` | `gr-gpt-image-2` | 既有模型，保留历史兼容 |
| `gpt-image-2.5-flare` | `gpt-image-2.5-flare-优化版` | 当前账号可用的异步图片模型 |
| `gpt-image-2.5-sunburst` | `gpt-image-2.5-sunburst-优化版` | 当前账号可用的异步图片模型 |
| `gemini-nano-banana-2.1` | `gemini-nano-banana-2.1` | Gemini 原生图片模型，走 `generateContent` |

2026-11-18 免费复查当前账号 `/v1/models`：不提供裸名 `gpt-image-2.5-flare`/`sunburst`，但提供 `-优化版`、`-官方` 和 `gr-gpt-image-2`。本项目使用已验证可走异步任务、返回 URL 的 `-优化版`；不要用 `-官方` 或 GR 别名替代异步链路。

Gemini 图片任务接口当前不可用：异步返回 `gemini-nano-banana-2.1-c` 不支持，同步只支持 Imagen。Gemini 必须走原生 `POST /v1beta/models/{model}:generateContent`，传入 `generationConfig.responseModalities=["TEXT","IMAGE"]` 和 `imageConfig`。响应可能是 `inlineData` 或 `fileData.fileUri`，两种都必须支持。

认证：

```http
Authorization: Bearer <YIJIE_API_KEY>
```

### 文生图

异步接口：

```http
POST /v1/images/generations/async
```

请求 JSON：

```json
{
  "model": "gpt-image-2.5-flare",
  "prompt": "提示词",
  "size": "1024x1024"
}
```

成功提交后读取任务 ID，使用：

```http
GET /v1/images/tasks/{id}
```

轮询直到 `status = succeeded`，结果图片读取 `data[0].url`。

### 图片编辑 / 多图参考编辑

异步接口：

```http
POST /v1/images/edits/async
```

请求 JSON：

```json
{
  "model": "gpt-image-2.5-flare",
  "prompt": "编辑指令",
  "size": "1024x1024",
  "image": [
    "https://provider-can-access.example/source-1.jpg",
    "https://provider-can-access.example/source-2.jpg"
  ]
}
```

`image` 是图片 URL 数组，可传多张图片。之后仍使用 `GET /v1/images/tasks/{id}` 查询任务。

### 尺寸与参数

GPT Image 2.0 已实测请求尺寸为 `1024x1024`、`1024x1536`、`1536x1024`；`1024x1024` 请求实际可能返回 `1254x1254`，必须保存并展示实际宽高。`gr-gpt-image-2` 已确认 `size` 和 `background` 生效，其中 `background=transparent` 已通过真实历史任务验证；其他参数不得展示或透传。

GPT Image 2.5 当前登记 1K/2K/4K 预设，覆盖 1:1、3:2、2:3、16:9、9:16；官方约束为宽高都是 16 的倍数、宽高比 1:3–3:1、最长边不超过 3840，超过 `2560x1440` 为实验档。16:9/9:16 必须使用真实比例尺寸，不能把 `1536x1024` 标成 16:9。2K/4K 与 `quality=xhigh/max` 可能进入更高计费档，Phase 0.5 必须逐项实测。

Gemini Nano Banana 2.1 当前只登记 1K 常用画幅，已验证通过原生 `generationConfig.imageConfig` 映射为 `1:1`/`3:2`/`2:3`/`16:9`/`9:16` 与 `imageSize=1K`。不要宣传 2K/4K，也不要改用图片异步接口。

模型参数以官方 Images 基础接口和模型 registry 为准，按模型分别登记：

- GPT Image 2.0：`size`、`background`（`auto`/`opaque`/`transparent`）；`gr-gpt-image-2` 不展示或透传 `quality`、`output_format`、`output_compression`、`moderation`。透明背景按渠道 PNG 输出处理。
- GPT Image 2.5：`quality`（`auto`/`low`/`medium`/`high`/`xhigh`/`max`）、`complexity`（默认 `high`）、`background`（含 `transparent`，只能搭配 PNG/WebP）、`output_format`、整数 `output_compression` 和 `moderation`。
- Gemini Nano Banana 2.1：当前只开放 `size`，由 Adapter 映射为 `imageConfig`，不发送 GPT 专属参数。

默认值只写入任务快照，用户改动过的非默认参数才透传上游；因此 registry 默认值必须与上游默认值一致，否则用户无法通过“选择默认值”显式下发该值。渠道可能忽略部分扩展字段，以实际结果为准。

仍然不要发送 `n`、`response_format`、`watermark`、`mask`。GPT Image 2.5 官方接口支持 `n` 1–10，但本项目产品固定单输出，发送层继续省略 `n`；不要把“支持多张”写成上游限制。

因此：

- 不要在一阶请求中发送 `n`；MVP 固定单输出。
- 2.5 可以显示 1K/2K/4K 预设，但帮助文案必须标注实验性/高费用；Gemini 未验证前不显示 2K/4K。
- “多图编辑”指多张输入参考图，不是一次生成多张结果。
- 上游可能返回一张或多张；本项目固定只读取并保存第一张，实际 MIME、格式、尺寸和 URL 有效期以 Phase 0.5 真实响应为准。
- 不要在代码或下载文件名中硬编码 `.png`；扩展名按实际 MIME 生成。

### 契约验证与能力开关

- 单图编辑和多图融合必须先完成 Phase 0.5 真实接口验证。Gemini 原生 Provider 已实现内联参考图编辑，并在 2026-11-18 完成单图/多图真实验证；对应开关可保持 `true`。
- 验证开关按模型族独立控制，不能共用全局开关：
  - `gr-gpt-image-2`：`YIJIE_EDIT_VERIFIED`、`YIJIE_MULTI_IMAGE_EDIT_VERIFIED`
  - GPT Image 2.5：`YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED`、`YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED`
  - Gemini Nano Banana 2.1：`YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED`、`YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED`
- 验证完成前，对应模型的开关必须保持 `false`，UI 能力禁用并提示；不能因为另一个模型验证通过就自动放开。
- 真实响应、失败结构、限制和 MIME 必须写回 `开发文档.md`，脱敏样本放入 `tests/fixtures/yijie/`。
- 真实付费请求前必须确认费用；探测脚本默认 dry-run，显式确认后才发请求。

## 5. 最重要的外部图片可访问性约束

一阶的异步编辑接口接收 `image` URL 数组，要求图片 URL 能被上游服务访问。

本地 Docker 网络中的 `http://minio:9000/...`、`http://localhost:...`、`127.0.0.1` 或浏览器本机路径不能直接交给一阶 API。

实现时必须：

1. 上传参考图到 Supabase Storage 的私有 bucket。
2. 生成供应商可访问的短期 HTTPS 签名 GET URL。
3. 将 URL 传给一阶 API。
4. 结果图片由服务端下载并保存到自己的存储。
5. 不把 API Key 或 `SUPABASE_SERVICE_ROLE_KEY` 暴露给浏览器。
6. 输入对象本身长期保留用于历史展示；签名 URL 只是临时授权，不是副本。
7. 如果要求提交后立即失效，可额外复制临时对象给上游，任务完成后删除临时对象，历史对象保留。

如果没有可用的 Supabase Storage 或其他外部存储配置，多图编辑不能算完成；必须在 UI 给出清晰配置提示，不能假装成功。

## 6. 架构原则

- 前端不直接调用一阶 API。
- API Key 只从服务端环境变量读取，并在启动时校验。
- 所有上游请求通过 `providers/yijie` Adapter。
- 业务层使用内部统一类型，不把一阶响应结构泄漏到 UI。
- 模型选择、尺寸和参数必须通过模型注册表和参数校验；不要在前端硬编码未验证参数，也不要静默忽略未知参数。
- 历史记录按 `conversationId` 聚合为连续对话；根任务创建随机 `conversationId`，再次编辑任务继承父任务。
- 前端始终显示当前模型名称、provider 和验证状态；模式常驻 composer 左下角，模型/参数放在可收起的设置弹层中，不要铺满创作页。
- 保存上游任务 ID、模型名、脱敏请求快照、状态、错误信息和结果资产。
- 结果图片必须下载并保存到自己的存储（第一版 Supabase Storage，后续可加本地磁盘驱动）；不能只保存一阶临时 URL。
- 任务轮询必须有最大等待时间、退避间隔、失败终态和可恢复的超时状态。
- 上游 `submitted` 归一为排队/处理中；任务查询 404 是失败终态，不能继续重试到超时；提交响应已成功并带结果 URL 时必须直接保存，不能因缺少任务 ID 判失败。
- 任务创建必须有服务端幂等保护，避免重复点击、多标签页或浏览器重试造成多次上游扣费。
- 任务状态机必须覆盖 `pending`、`submitting`、`processing`、`timed_out`、`submit_unknown`、`succeeded`、`failed`。
- worker 使用数据库租约领取任务；`pending` 和 `processing` 可恢复，`submitting` 租约过期进入 `submit_unknown`，不能自动重复提交。
- 所有输入做 MIME、magic bytes、文件大小、图片数量、像素数和提示词长度校验。
- 上传图片统一转码并剥离 EXIF；输出图片保留上游原始字节，扩展名按 MIME 生成。
- 下载上游结果时防 SSRF：HTTPS、拒绝私网地址、限制重定向、大小和超时。
- 历史详情通过本地预览/下载接口访问资产，不向浏览器暴露签名 URL 或存储凭证。
- 下载导出可通过服务端 `sharp` 做重采样、格式转换和 JPEG/WebP 压缩；必须明确“放大不增加真实细节”，不得把它宣传成 2K/4K 生成能力。
- 删除任务采用软删除；共享资产只有在无其他引用时才删除。
- 本地应用仍需基础安全：默认仅绑定 `127.0.0.1`、Origin/Host 校验、路径校验、随机文件名、日志脱敏。
- 本机代理只监听 `127.0.0.1` 时，Docker worker 使用 host 网络访问宿主代理和已发布的 `127.0.0.1:5432`；这是本机部署约束，迁移到其他环境时应改为可路由代理。
- `timed_out` 不等于失败；允许用户继续查询。`submit_unknown` 不能自动重试，UI 必须提示用户先核对上游。
- MVP 不提供取消任务，不设置 `cancelled` 状态。

## 7. 代码质量要求

- TypeScript 开启严格模式；避免 `any`。确需使用时写明原因。
- API 输入使用 Zod 校验；环境变量也使用 Zod 在启动时校验。
- 组件、业务逻辑、供应商 Adapter、数据库访问分层。
- 不要把业务逻辑写在 React 页面组件中。
- 所有环境变量在 `.env.example` 中列出，不提交真实密钥。
- 错误信息面向用户友好；详细错误只写服务端日志，并脱敏。
- 不要静默忽略不支持的参数。
- 所有数据库结构变更使用 Prisma migration。
- 为 Adapter 的请求映射、状态归一化、失败处理、幂等、worker 恢复、SSRF 和图片校验写测试。
- 依赖版本通过 lockfile 固定；Docker 构建可复现。

## 8. 推荐目录结构

```text
src/
  app/
    (studio)/
      create/
      history/
      system/
    api/
      models/
      uploads/
      images/
      history/
      assets/
      health/
      system/
  components/
    studio/
    history/
    editor/
    system/
    ui/
  modules/
    generation/
    models/
    assets/
    tasks/
    history/
    system/
    security/
  providers/
    contracts/
    yijie/
  lib/
    db/
    storage/
    validation/
    logging/
  types/
worker/
  index.ts
scripts/
  verify-yijie.ts
prisma/
  schema.prisma
tests/
  providers/yijie/
  fixtures/yijie/
docker/
docker-compose.yml
Dockerfile
.env.example
```

可以根据实际工程调整，但必须保持模块边界。

## 9. 开发执行规则

1. 日常代码改动必须在 `develop` 分支进行；`main` 保持干净，不直接写代码，只用于在 `develop` 出问题时回滚到正常基线。测试通过后再将 `develop` 并入 `main` 并提交远程仓库。
2. 开始编码前先检查仓库现状，不要覆盖已有项目。
3. 先阅读 `需求文档.md` 和 `开发文档.md`。
4. 按开发文档的阶段逐步实施，每个阶段完成后运行 lint、typecheck、tests 和 build。
5. 不要一次性生成所有功能后才验证。
6. 不确定的一阶 API 字段必须标记为待验证，并通过真实 API Key 的手动集成测试确认；不能猜测。
7. 单图编辑和多图融合开发前必须先完成 Phase 0.5 契约验证；验证前保持能力开关关闭。
8. 不要擅自把同步接口改成异步接口或反过来；本项目使用 worker 异步提交和轮询。
9. 真实付费 API 测试前必须确认费用；探测脚本默认 dry-run。
10. 任何需要用户提供的密钥、域名、存储配置，先使用环境变量占位，并在 `.env.example` 和 README 中说明。
11. 每次完成阶段后，汇报改动文件、验证命令、验证结果、未解决问题。
12. 修改 API 契约、任务状态、数据模型或验收标准时，同步更新三份文档。

## 10. 完成定义

第一版只有在以下全部满足时才算完成：

- Docker Compose 能启动应用、数据库、迁移服务和 worker，健康检查正常。
- 应用默认只绑定 `127.0.0.1`，不会意外暴露到局域网或公网。
- Phase 0.5 契约验证完成，真实响应、限制和错误结构已记录。
- 本地浏览器能打开创作页面。
- GPT Image 2.0、GPT Image 2.5 Flare/Sunburst、Gemini Nano Banana 2.1 均能提交一阶异步任务、查询状态并保存图片。
- 每个已接入模型的单图编辑和多图参考编辑在对应验证开关开启后能提交成功。
- 用户能查看历史、分页、预览、下载图片、继续编辑。
- 删除任务有二次确认，共享资产不会被误删。
- 重复点击和多标签页重复提交不会创建多个上游任务。
- 超时任务进入 `timed_out` 并可继续查询；worker 重启后能恢复 `pending`/`processing` 任务。
- 提交结果未知时进入 `submit_unknown`，不会自动重复扣费。
- API Key 不出现在前端 bundle、浏览器网络请求或日志中。
- 签名 URL 不写入数据库、不返回浏览器、不写完整日志。
- 对一阶无法访问的本地图片 URL 有明确处理。
- 上传文件拒绝伪造 MIME、超限文件、SVG 和超像素图片。
- 下载上游结果时拒绝私网地址、超大响应和过多重定向。
- 上游失败、超时、无结果、存储失败和配置缺失均有明确状态及提示。
- Supabase Storage 真实上传、签名 URL、GET、删除检查通过（`pnpm storage:check`）。
- 系统状态页只读，不显示密钥或完整签名 URL。
- 前端能看到当前模型名称/provider/验证状态；设置弹层可以切换模型和已登记参数。
- 未登记模型参数被服务端拒绝。
- 项目有 `.env.example`、Docker 配置、数据库迁移、测试和本地启动说明。
- `pnpm verify`（lint、typecheck、test、build）通过。

## 11. 文档职责

- `AGENTS.md`：项目级不可变约束、技术决策和完成定义。
- `需求文档.md`：产品范围、页面行为、用户可见状态和验收标准。
- `开发文档.md`：一阶契约、数据模型、API、任务状态机、存储、部署和测试细节。

详细技术实现以 `开发文档.md` 为准；产品行为以 `需求文档.md` 为准。修改时必须同步，避免三份文档漂移。

`AGENTS.md` 顶部由 `next dev` 自动维护 Next.js 托管块。项目级规则写在托管块之后；不要手工修改或重复维护托管块内容。
