import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/motion";
import { StockTable } from "@/components/inventario/stock-table";
import { requireTenant } from "@/lib/authz/session";
import { listStock } from "@/lib/inventario/stock";

/**
 * Stock actual.
 *
 * Los numeros salen de sumar los movimientos, no de una columna guardada. Las
 * ventas y compras que se registran en Finanzas son las que los mueven.
 */
export default async function InventarioPage() {
  const { tenantId } = await requireTenant();
  const rows = await listStock(tenantId);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <PageHeader
          title="Inventario"
          description="El stock se calcula sumando cada entrada y salida. Se mueve al registrar ventas y compras en Finanzas."
        />

        <StockTable rows={rows} />
      </div>
    </PageTransition>
  );
}
