import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Button>a</Button>
        <aside className="w-64 border-r p-4">
          <AppSidebar />
        </aside>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </SidebarProvider>
  );
}
