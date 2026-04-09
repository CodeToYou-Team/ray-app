"use client";

import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { TransactionTable } from "@/components/finanzas/transaction-table";
import { TransactionFormDialog } from "@/components/finanzas/transaction-form-dialog";
import { PageTransition } from "@/components/motion";
import { transactions } from "@/lib/mock-data";
import { useState } from "react";

export default function IngresosPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const incomes = transactions
    .filter((t) => t.type === "ingreso")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Ingresos</h2>
            <p className="text-sm text-muted-foreground">
              Registro y seguimiento de todos tus ingresos
            </p>
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <IconPlus className="size-3.5" />
            Registrar ingreso
          </Button>
        </div>

        <TransactionTable
          transactions={incomes}
          title="Todos los ingresos"
          showTotal
        />

        <TransactionFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type="ingreso"
        />
      </div>
    </PageTransition>
  );
}
