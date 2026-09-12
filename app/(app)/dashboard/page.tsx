import { PageTransition } from "@/components/motion";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { loadDashboard } from "@/lib/finanzas/dashboard";

export default async function DashboardPage() {
  const { monedas, recientes, alertas, productosActivos } = await loadDashboard();

  return (
    <PageTransition>
      <DashboardContent
        monedas={monedas}
        recientes={recientes}
        alertas={alertas}
        productosActivos={productosActivos}
      />
    </PageTransition>
  );
}
