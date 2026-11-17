import type { ReactNode } from "react";
import { StudioSidebar } from "@/components/studio/studio-sidebar";
import { PageScrollbar } from "@/components/ui/page-scrollbar";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f7f5] md:flex">
      <StudioSidebar />
      <main className="min-w-0 flex-1">{children}</main>
      <PageScrollbar />
    </div>
  );
}
