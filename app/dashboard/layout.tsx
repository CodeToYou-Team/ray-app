import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { Header } from "@/components/layout/header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="app-shell-main">
          <div className="content-wrap">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
