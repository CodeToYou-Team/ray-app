import { PageTransition } from "@/components/motion";
import { TransactionsView } from "@/components/finanzas/transactions-view";
import {
  loadTransactionsPage,
  type TransactionsSearchParams,
} from "@/lib/finanzas/page-data";

/**
 * Server Component: la consulta trae solo la pagina que se muestra, ya filtrada
 * y ordenada por Postgres. Las escrituras van por los Server Actions.
 */
export default async function IngresosPage({
  searchParams,
}: {
  searchParams: Promise<TransactionsSearchParams>;
}) {
  const data = await loadTransactionsPage("ingreso", await searchParams);

  return (
    <PageTransition>
      <TransactionsView
        title="Ingresos"
        description="Registro y seguimiento de todos tus ingresos"
        type="ingreso"
        {...data}
      />
    </PageTransition>
  );
}
