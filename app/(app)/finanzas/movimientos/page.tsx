import { PageTransition } from "@/components/motion";
import { TransactionsView } from "@/components/finanzas/transactions-view";
import {
  loadTransactionsPage,
  type TransactionsSearchParams,
} from "@/lib/finanzas/page-data";

/**
 * Ingresos y gastos juntos, con balance por moneda.
 *
 * Es la unica pantalla que muestra balance, y lo hace por moneda: restar gastos
 * en Bs de ingresos en USD no da ningun numero con significado.
 */
export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<TransactionsSearchParams>;
}) {
  const data = await loadTransactionsPage(undefined, await searchParams);

  return (
    <PageTransition>
      <TransactionsView
        title="Movimientos"
        description="Todos los ingresos y gastos, con el balance de cada moneda"
        {...data}
      />
    </PageTransition>
  );
}
