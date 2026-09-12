import { PageTransition } from "@/components/motion";
import { TransactionsView } from "@/components/finanzas/transactions-view";
import { loadTransactionsPage } from "@/lib/finanzas/page-data";

/**
 * Server Component: la consulta trae solo la pagina que se muestra, ya filtrada
 * y ordenada por Postgres. Las escrituras van por los Server Actions.
 */
export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const data = await loadTransactionsPage("gasto", await searchParams);

  return (
    <PageTransition>
      <TransactionsView
        title="Gastos"
        description="Registro y seguimiento de todos tus gastos"
        type="gasto"
        {...data}
      />
    </PageTransition>
  );
}
