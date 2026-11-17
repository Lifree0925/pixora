import { Activity, AlertCircle, CheckCircle2, CircleSlash } from "lucide-react";
import { getSystemStatus } from "@/modules/system/status";

export const dynamic = "force-dynamic";

const checkLabels: Record<string, string> = {
  database: "数据库",
  storage: "对象存储",
  configuration: "一阶 API 配置",
  worker: "Worker 心跳",
};

const stateLabels: Record<string, string> = {
  ok: "正常",
  configured: "已配置",
  not_configured: "未配置",
  error: "异常",
  unknown: "未知",
};

function StateIcon({ state }: { state: string }) {
  if (state === "ok" || state === "configured") {
    return <CheckCircle2 className="size-4 text-emerald-600" />;
  }
  if (state === "error") {
    return <AlertCircle className="size-4 text-destructive" />;
  }
  return <CircleSlash className="size-4 text-muted-foreground" />;
}

export default async function SystemPage() {
  let status: Awaited<ReturnType<typeof getSystemStatus>> | null = null;
  let error: string | null = null;

  try {
    status = await getSystemStatus();
  } catch {
    error = "系统状态读取失败，请检查数据库和环境变量配置。";
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground">
          <Activity className="size-3.5" />
          只读状态
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">系统状态</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          这里只显示配置是否存在和检查结果，不显示 API Key、对象存储密钥或完整预签名 URL。
        </p>
      </header>

      {error || !status ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          {error ?? "系统状态不可用"}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-3xl border bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-sm font-semibold">运行信息</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">应用版本</dt>
                <dd className="mt-1 font-medium">{status.app.version}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Node</dt>
                <dd className="mt-1 font-medium">{status.app.node}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">访问模式</dt>
                <dd className="mt-1 font-medium">仅本机 {status.app.bindHost}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">模型</dt>
                <dd className="mt-1 font-medium">{status.model.id}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-3xl border bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-sm font-semibold">健康检查</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(status.health.checks).map(([key, state]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-2xl bg-[#f7f7f5] px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <StateIcon state={state} />
                    {checkLabels[key] ?? key}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {stateLabels[state] ?? state}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-sm font-semibold">能力与限制</h2>
            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">API Key</p>
                <p className="mt-1 font-medium">
                  {status.model.apiKeyConfigured ? "已配置" : "未配置"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">单图编辑能力</p>
                <p className="mt-1 font-medium">
                  {status.model.editVerified ? "已验证" : "未验证"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">多图融合能力</p>
                <p className="mt-1 font-medium">
                  {status.model.multiImageEditVerified ? "已验证" : "未验证"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">存储驱动</p>
                <p className="mt-1 font-medium">
                  {status.storage.driver === "supabase"
                    ? "Supabase Storage"
                    : status.storage.driver}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">对象存储</p>
                <p className="mt-1 font-medium">
                  {status.storage.configured ? "已配置" : "未配置"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">最大参考图</p>
                <p className="mt-1 font-medium">{status.limits.maxReferenceImages} 张</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">提示词上限</p>
                <p className="mt-1 font-medium">{status.limits.promptMaxChars} 字符</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
