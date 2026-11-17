"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson, ClientApiError } from "@/lib/client/api";
import { getTaskStatusLabel } from "@/lib/task-status";
import type { HistoryConversationItem } from "@/types/api";

function messageOf(error: unknown): string {
  return error instanceof ClientApiError || error instanceof Error ? error.message : "加载历史失败";
}

async function fetchHistory(cursor?: string) {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) {
    query.set("cursor", cursor);
  }
  return fetchJson<{ items: HistoryConversationItem[]; nextCursor: string | null }>(
    `/api/history?${query.toString()}`,
  );
}

export function HistoryList() {
  const [items, setItems] = useState<HistoryConversationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchHistory()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setItems(data.items);
        setNextCursor(data.nextCursor);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(messageOf(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    if (!nextCursor) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchHistory(nextCursor);
      setItems((current) => [...current, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">历史对话</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            每次创作和后续编辑会归入同一个对话，按时间连续查看提示词与结果。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setLoading(true);
            setError(null);
            void fetchHistory()
              .then((data) => {
                setItems(data.items);
                setNextCursor(data.nextCursor);
              })
              .catch((loadError) => setError(messageOf(loadError)))
              .finally(() => setLoading(false));
          }}
        >
          <RefreshCw />
          刷新
        </Button>
      </header>

      {error ? (
        <div className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          正在加载对话…
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed bg-white/60 p-8 text-center">
          <MessageSquare className="size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">暂无历史对话</p>
          <p className="mt-1 text-xs text-muted-foreground">
            完成第一次创作后，这里会按对话整理提示词和生成结果。
          </p>
          <Link href="/create" className="mt-4 text-sm font-medium underline underline-offset-4">
            去创作
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const pending = ["pending", "submitting", "processing"].includes(item.status);
            const failed = item.status === "failed" || item.status === "submit_unknown";
            return (
              <Link
                key={item.id}
                href={`/history/${item.id}`}
                className="group flex gap-3 rounded-2xl border bg-white p-3 transition-colors hover:bg-[#faf9f6]"
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {item.thumbnailUrl ? (
                    <Image
                      src={item.thumbnailUrl}
                      alt="最新结果缩略图"
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">
                      {pending ? "生成中" : "无结果"}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="line-clamp-1 text-sm font-medium">{item.title}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {item.latestPromptSummary}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3" />
                      {item.turnCount} 轮
                    </span>
                    <span>·</span>
                    <span>{item.modelName}</span>
                    {pending ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                        <Loader2 className="size-3 animate-spin" />
                        处理中
                      </span>
                    ) : null}
                    {failed ? (
                      <span className="rounded-full bg-destructive/5 px-2 py-0.5 text-destructive">
                        {getTaskStatusLabel(item.status)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}

          {nextCursor ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Loader2 className="animate-spin" /> : null}
                {loadingMore ? "加载中" : "加载更多"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
