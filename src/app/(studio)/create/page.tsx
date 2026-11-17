import { Suspense } from "react";
import { CreateWorkspace } from "@/components/studio/create-workspace";

export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-12 text-sm text-muted-foreground">正在加载创作工作台…</div>
      }
    >
      <CreateWorkspace />
    </Suspense>
  );
}
