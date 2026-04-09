"use client";

import { useState } from "react";
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconSearch,
  IconFilter,
  IconDownload,
} from "@tabler/icons-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Transaction,
  formatCurrency,
  formatDate,
  incomeCategories,
  expenseCategories,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface TransactionTableProps {
  transactions: Transaction[];
  title: string;
  showTypeFilter?: boolean;
  showTotal?: boolean;
}

export function TransactionTable({
  transactions: allTransactions,
  title,
  showTypeFilter = false,
  showTotal = true,
}: TransactionTableProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);
  const perPage = 10;

  const categories = showTypeFilter
    ? [...new Set([...incomeCategories, ...expenseCategories])]
    : allTransactions[0]?.type === "ingreso"
      ? incomeCategories
      : expenseCategories;

  const filtered = allTransactions.filter((tx) => {
    if (search && !tx.concept.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== "all" && tx.category !== categoryFilter)
      return false;
    if (typeFilter !== "all" && tx.type !== typeFilter) return false;
    return true;
  });

  const total = filtered.reduce(
    (sum, tx) => sum + (tx.type === "ingreso" ? tx.amount : -tx.amount),
    0,
  );
  const totalIncome = filtered
    .filter((t) => t.type === "ingreso")
    .reduce((s, t) => s + t.amount, 0);
  const totalExpenses = filtered
    .filter((t) => t.type === "gasto")
    .reduce((s, t) => s + t.amount, 0);

  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {showTotal && (
            <div className="flex items-center gap-3 text-xs">
              {showTypeFilter && (
                <>
                  <span className="text-success font-medium">
                    Ingresos: {formatCurrency(totalIncome)}
                  </span>
                  <span className="text-destructive font-medium">
                    Gastos: {formatCurrency(totalExpenses)}
                  </span>
                  <span className="font-semibold">
                    Balance: {formatCurrency(total)}
                  </span>
                </>
              )}
              {!showTypeFilter && (
                <span className="font-semibold">
                  Total: {formatCurrency(Math.abs(total))}
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por concepto..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select
            value={categoryFilter}
            onValueChange={(v: string) => {
              setCategoryFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
              <IconFilter className="size-3 mr-1.5" />
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showTypeFilter && (
            <Select
              value={typeFilter}
              onValueChange={(v: string) => {
                setTypeFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ingreso">Ingresos</SelectItem>
                <SelectItem value="gasto">Gastos</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <IconDownload className="size-3" />
            Exportar
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                  Tipo
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                  Concepto
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                  Categoría
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                  Fecha
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9 text-right">
                  Monto
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <div className="text-muted-foreground">
                      <p className="text-sm font-medium">Sin resultados</p>
                      <p className="text-xs mt-1">
                        No hay movimientos que coincidan con los filtros
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((tx) => (
                  <TableRow key={tx.id} className="group">
                    <TableCell className="py-2.5">
                      <div
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md",
                          tx.type === "ingreso"
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {tx.type === "ingreso" ? (
                          <IconArrowUpRight className="size-3.5" />
                        ) : (
                          <IconArrowDownRight className="size-3.5" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="text-sm font-medium">{tx.concept}</span>
                      {tx.origin && (
                        <span className="text-[11px] text-muted-foreground block">
                          {tx.origin}
                        </span>
                      )}
                      {tx.provider && (
                        <span className="text-[11px] text-muted-foreground block">
                          {tx.provider}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-normal"
                      >
                        {tx.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2.5 text-right text-sm font-semibold tabular-nums",
                        tx.type === "ingreso"
                          ? "text-success"
                          : "text-destructive",
                      )}
                    >
                      {tx.type === "ingreso" ? "+" : "-"}
                      {formatCurrency(tx.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              {filtered.length} movimiento{filtered.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground px-2">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
