"use client";

import { TransactionTable } from "@/components/finanzas/transaction-table";
import { PageTransition } from "@/components/motion";
import { transactions } from "@/lib/mock-data";

export default function MovimientosPage() {
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Movimientos</h2>
          <p className="text-sm text-muted-foreground">
            Vista unificada de todos los ingresos y gastos
          </p>
        </div>

        <TransactionTable
          transactions={sorted}
          title="Todos los movimientos"
          showTypeFilter
          showTotal
        />
      </div>
    </PageTransition>
  );
}

