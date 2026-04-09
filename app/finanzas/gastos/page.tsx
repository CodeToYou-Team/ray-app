"use client";

import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { TransactionTable } from "@/components/finanzas/transaction-table";
import { TransactionFormDialog } from "@/components/finanzas/transaction-form-dialog";
import { PageTransition } from "@/components/motion";
import { transactions } from "@/lib/mock-data";
import { useState } from "react";

export default function GastosPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const expenses = transactions
    .filter((t) => t.type === "gasto")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Gastos</h2>
            <p className="text-sm text-muted-foreground">
              Control detallado de todos tus gastos operativos
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <IconPlus className="size-3.5" />
            Registrar gasto
          </Button>
        </div>

        <TransactionTable
          transactions={expenses}
          title="Todos los gastos"
          showTotal
        />

        <TransactionFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type="gasto"
        />
      </div>
    </PageTransition>
  );
}
