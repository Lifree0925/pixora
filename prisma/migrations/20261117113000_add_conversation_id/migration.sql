-- 历史记录以对话为单位展示。旧数据先按父任务链回溯到根任务，
-- 再把根任务 ID 回填为整条对话的 conversationId。
ALTER TABLE "GenerationTask" ADD COLUMN "conversationId" TEXT;

WITH RECURSIVE "conversation_roots" AS (
  SELECT "id", "id" AS "rootId"
  FROM "GenerationTask"
  WHERE "parentTaskId" IS NULL

  UNION ALL

  SELECT child."id", roots."rootId"
  FROM "GenerationTask" AS child
  INNER JOIN "conversation_roots" AS roots ON child."parentTaskId" = roots."id"
)
UPDATE "GenerationTask" AS task
SET "conversationId" = roots."rootId"
FROM "conversation_roots" AS roots
WHERE task."id" = roots."id";

-- 防御性兜底：异常孤立任务各自成为一个会话。
UPDATE "GenerationTask"
SET "conversationId" = "id"
WHERE "conversationId" IS NULL;

ALTER TABLE "GenerationTask" ALTER COLUMN "conversationId" SET NOT NULL;
CREATE INDEX "GenerationTask_conversationId_idx" ON "GenerationTask"("conversationId");
