# Pixora

本地运行的 AI 图片创作 Web 应用。当前接入一阶 API 的 `gr-gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` 和 `gemini-nano-banana-2.1`，默认仅本机访问。

## 当前阶段

开发文档中的 Phase 0 至 Phase 5 功能已完成并验证：

- Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- PostgreSQL + Prisma 完整任务/资产模型
- Supabase Storage：上传、签名 URL、读取、删除
- 文生图、单图编辑、多图融合
- 模型注册表、模型选择、当前模型展示和参数校验框架
- ChatGPT 式创作页：模型/参数收在设置弹层，模式常驻 composer 左下角；输入框自动向上扩展；侧边栏可收起；发送后清空输入；结果图点击可缩放查看
- worker 异步提交、轮询、超时继续查询和 submit_unknown 处理
- 对话式历史：按 conversationId 聚合多轮提示与结果，支持查看、下载、图片编辑、多图融合继续创作、软删除和共享资产保护
- 下载导出：原图/长边 1K/1.5K/2K/4K、PNG/JPEG/WebP、20–100 压缩质量；大于原图时明确提示仅重采样
- `/api/health`、`/api/models`、`/api/system/status`
- Docker Compose：数据库、迁移、Web、worker、可选 MinIO
- GPT Image 2.0 的 Phase 0.5 真实契约探测已完成；GPT Image 2.5 与 Gemini Nano Banana 2.1 仍待真实付费验证
- mock 端到端测试覆盖完整创作闭环

## 版本

- Node.js 22.23.5（最低要求 22）
- pnpm 12.21.0
- Next.js 16.4.6
- React 19.3.0
- Prisma 6.19.3
- Tailwind CSS 4.3.3
- Supabase JS 2.119.0
- PostgreSQL 17

## 环境要求

- Node.js 22+
- pnpm 12+
- Docker Engine + Docker Compose v2

## Supabase Storage 配置

1. 在 Supabase 创建 Free Plan 项目。
2. Storage 中创建私有 bucket：`pixora-inputs`。
3. 在 Project Settings → API 复制 Project URL 和 `service_role` secret key。
4. 在 `.env` 中填写：

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=pixora-inputs
SUPABASE_SIGNED_URL_EXPIRES_SECONDS=3600
```

如果结果 CDN 在当前网络不可达，再配置：

```env
OUTBOUND_PROXY_URL=http://127.0.0.1:7890
OUTBOUND_PROXY_URL_DOCKER=http://host.docker.internal:7890
```

Docker worker 使用 host 网络访问宿主 `127.0.0.1:7890` 和已发布数据库端口；web 使用 Docker 网络。

注意：

- `SUPABASE_URL` 是项目根地址，不要带 `/rest/v1/` 或 `/storage/v1/`。
- `SUPABASE_SERVICE_ROLE_KEY` 只存在服务端，不能加 `NEXT_PUBLIC_`，不能提交到仓库。
- bucket 保持私有，参考图通过短期签名 URL 给一阶访问。
- 不需要公开 bucket，也不需要配置 CORS。

验证存储：

```bash
pnpm storage:check
```

脚本会真实执行：上传 1×1 PNG → 生成签名 URL → GET → 删除。输出不会打印密钥或完整签名 URL。

## 模型与参数

当前模型：

| 展示名 | 内部 ID / 上游公开名 | 说明 |
| --- | --- | --- |
| GPT Image 2.0 | `gr-gpt-image-2` | 已真实验证 |
| GPT Image 2.5 Flare | `gpt-image-2.5-flare` → `gpt-image-2.5-flare-优化版` | 文生图、单图编辑、多图融合已验证 |
| GPT Image 2.5 Sunburst | `gpt-image-2.5-sunburst` → `gpt-image-2.5-sunburst-优化版` | 文生图、单图编辑、多图融合已验证 |
| Gemini Nano Banana 2.1 | `gemini-nano-banana-2.1`（原生 `generateContent`） | 文生图、单图编辑、多图融合已验证 |

- 模型定义：`src/modules/models/registry.ts`
- Provider 工厂：`src/providers/index.ts`
- 前端 composer 始终显示当前模型胶囊和模式菜单；模式在左下角直接切换，模型和参数通过设置按钮打开弹层。
- GPT Image 2.0 开放 `size` 和 `background`，透明背景已验证；其余扩展参数未开放。
- GPT Image 2.5 开放 `quality`（含 `xhigh/max`）、`complexity` 和 `background=transparent`；透明背景只能搭配 PNG/WebP。
- Gemini Nano Banana 2.1 当前只开放 `size`，由 Adapter 映射为原生 `imageConfig`；它不走 `/v1/images/*`，响应兼容 `inlineData` 和 `fileData.fileUri`。
- GPT 2.5 与 Gemini 的单图、多图编辑均已通过真实历史图验证，对应开关为 `true`；Mask/Markup 尚未实现。
- 默认值只保存在任务快照中，实际改动过的参数才会透传上游。
- 当前渠道对部分官方扩展字段可能只透传不生效；界面会明确说明，最终以实际结果和渠道能力为准。
- 新增模型时，同时添加模型定义、Provider 映射和对应参数校验；前端会自动渲染 registry 声明的参数。
- 未登记参数会被服务端拒绝，不会静默忽略。

## 本机开发

```bash
cp .env.example .env
pnpm install
pnpm dev
```

worker 热更新：

```bash
pnpm worker:dev
```

上传接口示例：

```bash
curl -X POST -F "file=@test.png;type=image/png" http://127.0.0.1:3000/api/uploads
```

## Docker 启动

```bash
cp .env.example .env
# 填写 YIJIE_API_KEY 和 Supabase Storage 配置
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs -f web worker
```

应用默认绑定 `127.0.0.1:3000`，不会开放到局域网或公网。

镜像结构：

- `pixora-app:local`：web 与 worker 共用，只包含 Next.js standalone、静态资源、worker bundle 和必要运行时依赖。
- `pixora-migrate:local`：只包含精确版本的 Prisma CLI 和迁移文件，不加载应用环境变量。
- web/worker 使用非 root 用户，OpenSSL、日志轮转和 worker 心跳健康检查都已配置。

升级后如需清理旧镜像，先用 `docker images` 核对 Repository/Tag，再删除未被容器引用的旧镜像 ID。不要直接运行全局 `docker system prune`，本机还有其他项目共用 Docker 缓存。

## 数据库迁移

```bash
pnpm db:generate
pnpm db:migrate
```

Docker 中由独立 `migrate` 服务执行 `prisma migrate deploy`。

## 健康检查

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/system/status
```

## Phase 0.5 契约探测

Phase 0.5 已完成：文生图三种尺寸、单图编辑、多图融合均真实成功。脱敏样本在 `tests/fixtures/yijie/`。

脚本默认 dry-run，不会发送付费请求：

```bash
pnpm verify:yijie --mode text
```

确认费用后再执行真实请求：

```bash
pnpm verify:yijie --mode text --model gpt-image-2.5-flare --confirm --write-fixtures
```

单图/多图编辑从文件读取签名 URL，避免 URL 出现在命令行：

```bash
pnpm probe:prepare
pnpm verify:yijie --mode edit --model gpt-image-2.5-flare --assets-file /tmp/pixora-probe-assets.json --confirm --write-fixtures
pnpm verify:yijie --mode multi --model gemini-nano-banana-2.1 --assets-file /tmp/pixora-probe-assets.json --confirm --write-fixtures
pnpm probe:cleanup
```

GPT Image 2.0、GPT Image 2.5 与 Gemini 的编辑/多图开关均已通过真实请求验证并设为 `true`。

## 端到端验证

```bash
pnpm e2e:mock
```

该命令需要一个指向 mock 一阶的本地 web/worker；E2E 覆盖上传、文生图、单图编辑、多图融合、历史、下载、历史多图融合、删除和共享资产保护。

## 可选 S3 / MinIO

S3 兼容存储不是 MVP 必需项。后续需要时再配置：

```bash
docker compose --profile local-storage up -d minio minio-init
```

MinIO 仅用于本地开发或非编辑场景。编辑功能优先使用 Supabase Storage 的签名 URL。

## 备份与恢复

- PostgreSQL：使用 `pg_dump` 备份数据库。
- Supabase Storage：备份 `pixora-inputs` bucket 或保留对象清单。
- 升级前先备份数据库和 bucket。

## 安全边界

- API Key 只在服务端环境变量。
- 默认仅 `127.0.0.1`。
- Supabase service role key 只在服务端。
- 不向浏览器返回 Supabase service role key、长期存储凭证或完整签名 URL。
- 日志不记录 Authorization、API Key、`SUPABASE_SERVICE_ROLE_KEY` 或完整签名 URL。

## 验收状态

- `pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（25 个单元测试）；Docker 内 Next.js 生产构建通过。
- `pnpm storage:check` 通过。
- `pnpm e2e:mock` 通过（编译后的 worker）。
- Phase 0.5 真实文生图三种尺寸、单图编辑、多图融合通过。
- 真实应用文生图和单图编辑端到端通过：上传/提交 → worker → 一阶 → 代理下载 → Supabase → 预览/下载 → 删除。
- 无头 Chrome 检查 ChatGPT 式创作页和设置弹层通过；输入框自动扩展、发送后清空、侧边栏收起、结果图点击缩放正常；当前模型和参数可见。
- `localhost:3000` 与 `127.0.0.1:3000` 均可提交；非本机 Origin 仍被拒绝。
- 幂等重复提交、数据库重启持久化、Docker 健康检查通过。
- 镜像重构后 `pixora-app:local` 约 517MB（旧镜像 1.75GB）；web、worker、db 均为 healthy。

已知限制：真实上游的 429、失败、无 `data` 故障注入尚未执行；相关分支由 mock/单元测试覆盖。

## 已知问题

- 结果 CDN 在当前网络需要 `OUTBOUND_PROXY_URL`，否则会出现 `ENETUNREACH`。
