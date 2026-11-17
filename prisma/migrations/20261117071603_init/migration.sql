-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('text_to_image', 'image_edit', 'multi_image_edit');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'submitting', 'processing', 'timed_out', 'submit_unknown', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AssetRelation" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('uploaded', 'generated');

-- CreateTable
CREATE TABLE "GenerationTask" (
    "id" TEXT NOT NULL,
    "mode" "GenerationMode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerTaskId" TEXT,
    "providerRawStatus" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "parentTaskId" TEXT,
    "parentAssetId" TEXT,
    "submissionStartedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "pollWindowStartedAt" TIMESTAMP(3),
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "origin" "AssetOrigin" NOT NULL,
    "thumbnailStorageKey" TEXT,
    "thumbnailMimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAsset" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "relation" "AssetRelation" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_idempotencyKey_key" ON "GenerationTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationTask_status_nextPollAt_idx" ON "GenerationTask"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX "GenerationTask_createdAt_idx" ON "GenerationTask"("createdAt");

-- CreateIndex
CREATE INDEX "GenerationTask_parentTaskId_idx" ON "GenerationTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "GenerationTask_deletedAt_idx" ON "GenerationTask"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationTask_provider_providerTaskId_key" ON "GenerationTask"("provider", "providerTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "ImageAsset_storageKey_key" ON "ImageAsset"("storageKey");

-- CreateIndex
CREATE INDEX "ImageAsset_sha256_idx" ON "ImageAsset"("sha256");

-- CreateIndex
CREATE INDEX "ImageAsset_createdAt_idx" ON "ImageAsset"("createdAt");

-- CreateIndex
CREATE INDEX "ImageAsset_deletedAt_idx" ON "ImageAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "TaskAsset_taskId_idx" ON "TaskAsset"("taskId");

-- CreateIndex
CREATE INDEX "TaskAsset_assetId_idx" ON "TaskAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAsset_taskId_relation_sortOrder_key" ON "TaskAsset"("taskId", "relation", "sortOrder");

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "GenerationTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationTask" ADD CONSTRAINT "GenerationTask_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "ImageAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAsset" ADD CONSTRAINT "TaskAsset_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAsset" ADD CONSTRAINT "TaskAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ImageAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
