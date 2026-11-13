import Link from "next/link";
import {
  IconAlertTriangle,
  IconPackageOff,
  IconCheck,
} from "@tabler/icons-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireTenant } from "@/lib/authz/session";
import { listStock } from "@/lib/inventario/stock";
import { cn } from "@/lib/utils";

/** "7.000" -> "7". */
function cantidad(value: string): string {
  return value.replace(/\.?0+$/, "") || "0";
}

/**
 * Alertas de inventario.
 *
 * No hay tabla de alertas: se derivan del stock, que a su vez se deriva de los
 * movimientos. Una tabla de alertas habria que mantenerla sincronizada y podria
 * quedar mintiendo; derivarlas no puede desincronizarse de nada.
 */
export default async function AlertasPage() {
  const { tenantId } = await requireTenant();
  const stock = await listStock(tenantId);

  const sinStock = stock.filter((s) => s.status === "sin_stock");
  const bajos = stock.filter((s) => s.status === "bajo");
  const sinMinimo = stock.filter((s) => s.status === "ok" && s.minStock === null);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-5xl mx-auto">
        <PageHeader
          title="Alertas de inventario"
          description="Productos que necesitan reposición. El stock sale de sumar cada entrada y salida."
        />

        {sinStock.length === 0 && bajos.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl bg-success/10 text-success">
                <IconCheck className="size-5" />
              </div>
              <div>
                <p className="font-medium">Todo en orden</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {stock.length === 0
                    ? "Todavía no hay productos en el catálogo."
                    : "Ningún producto está agotado ni por debajo de su mínimo."}
                </p>
              </div>
              {stock.length === 0 && (
                <Button size="sm" asChild>
                  <Link href="/productos">Crear un producto</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {sinStock.length > 0 && (
              <AlertGroup
                title="Agotados"
                description="Sin unidades disponibles. No se pueden vender."
                icon={IconPackageOff}
                tone="destructive"
                rows={sinStock}
              />
            )}
            {bajos.length > 0 && (
              <AlertGroup
                title="Por debajo del mínimo"
                description="Quedan menos unidades de las que definiste como mínimo."
                icon={IconAlertTriangle}
                tone="warning"
                rows={bajos}
              />
            )}
          </>
        )}

        {/*
          Un producto sin minimo definido nunca va a avisar que se esta
          acabando. No es un error, pero conviene saberlo: sin ese numero la
          pantalla de alertas es ciega para ese producto.
        */}
        {sinMinimo.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sin mínimo definido</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Estos productos nunca van a aparecer como stock bajo, porque no
                tienen un mínimo con el cual comparar. Puedes definirlo al
                editarlos.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sinMinimo.map((s) => (
                  <Badge key={s.productId} variant="outline" className="text-[11px]">
                    {s.name}
                    <span className="ml-1.5 font-mono text-muted-foreground">
                      {cantidad(s.stock)}
                    </span>
                  </Badge>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-3" asChild>
                <Link href="/productos">Ir a productos</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageTransition>
  );
}

function AlertGroup({
  title,
  description,
  icon: Icon,
  tone,
  rows,
}: {
  title: string;
  description: string;
  icon: typeof IconAlertTriangle;
  tone: "destructive" | "warning";
  rows: { productId: string; name: string; sku: string | null; stock: string; minStock: string | null }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-lg",
              tone === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-warning/10 text-warning",
            )}
          >
            <Icon className="size-4" />
          </span>
          {title}
          <Badge variant="secondary" className="text-[10px]">
            {rows.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="w-28">SKU</TableHead>
              <TableHead className="w-20 text-right">Stock</TableHead>
              <TableHead className="w-20 text-right">Mínimo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.sku ?? "—"}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-sm font-medium",
                    tone === "destructive" ? "text-destructive" : "text-warning",
                  )}
                >
                  {cantidad(r.stock)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {r.minStock ? cantidad(r.minStock) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
