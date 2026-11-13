"use client";

import { useState } from "react";
import {
  TriangleAlert,
  PackageX,
  Check,
  Search,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StockStatus } from "@/lib/inventario/stock";

export interface StockRow {
  productId: string;
  name: string;
  sku: string | null;
  stock: string;
  minStock: string | null;
  status: StockStatus;
}

const STATUS: Record<
  StockStatus,
  { label: string; icon: typeof Check; className: string }
> = {
  sin_stock: {
    label: "Sin stock",
    icon: PackageX,
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  bajo: {
    label: "Bajo",
    icon: TriangleAlert,
    className: "bg-warning/10 text-warning border-warning/20",
  },
  ok: {
    label: "Disponible",
    icon: Check,
    className: "bg-success/10 text-success border-success/20",
  },
};

/** Quita los decimales que no aportan: "7.000" -> "7", "1.500" -> "1.5". */
function cantidad(value: string): string {
  return value.replace(/\.?0+$/, "") || "0";
}

export function StockTable({ rows }: { rows: StockRow[] }) {
  const [search, setSearch] = useState("");

  const filtradas = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.sku ?? "").toLowerCase().includes(q)
    );
  });

  const conteos = {
    sin_stock: rows.filter((r) => r.status === "sin_stock").length,
    bajo: rows.filter((r) => r.status === "bajo").length,
    ok: rows.filter((r) => r.status === "ok").length,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(["ok", "bajo", "sin_stock"] as StockStatus[]).map((s) => {
          const meta = STATUS[s];
          return (
            <Card key={s}>
              <CardContent className="flex items-center gap-3 p-4">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg border",
                    meta.className,
                  )}
                >
                  <meta.icon className="size-4" />
                </div>
                <div>
                  <p className="text-lg font-semibold leading-none">
                    {conteos[s]}
                  </p>
                  <p className="text-xs text-muted-foreground">{meta.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o SKU…"
              className="pl-9"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="w-32">SKU</TableHead>
                <TableHead className="w-24 text-right">Stock</TableHead>
                <TableHead className="w-24 text-right">Mínimo</TableHead>
                <TableHead className="w-32">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {rows.length === 0
                      ? "Todavía no hay productos. El stock se mueve registrando compras y ventas."
                      : "Ningún producto coincide con la búsqueda."}
                  </TableCell>
                </TableRow>
              )}

              {filtradas.map((r) => {
                const meta = STATUS[r.status];
                return (
                  <TableRow key={r.productId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.sku ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {cantidad(r.stock)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {r.minStock ? cantidad(r.minStock) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("gap-1 text-[10px]", meta.className)}
                      >
                        <meta.icon className="size-3" />
                        {meta.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
