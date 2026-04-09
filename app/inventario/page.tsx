"use client";

import { useState } from "react";
import {
  IconSearch,
  IconPackage,
  IconAlertTriangle,
  IconCircleMinus,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  PageTransition,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion";
import {
  products,
  productCategories,
  formatCurrency,
  getStockStatus,
  getLowStockProducts,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function InventarioPage() {
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filtered = products.filter((p) => {
    if (!p.active) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (stockFilter === "ok" && getStockStatus(p) !== "ok") return false;
    if (stockFilter === "low" && getStockStatus(p) !== "low") return false;
    if (stockFilter === "none" && getStockStatus(p) !== "none") return false;
    return true;
  });

  const lowStockCount = getLowStockProducts().length;
  const noStockCount = products.filter((p) => p.active && p.stock === 0).length;
  const totalValue = products.reduce((s, p) => s + p.stock * p.salePrice, 0);
  const totalUnits = products.reduce((s, p) => s + p.stock, 0);

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div>
          <h2 className="text-lg font-bold">Stock Disponible</h2>
          <p className="text-sm text-muted-foreground">
            Estado actual del inventario con indicadores de nivel
          </p>
        </div>

        {/* Summary cards */}
        <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconPackage className="size-3.5 text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Total unidades
                  </span>
                </div>
                <p className="text-xl font-bold">
                  {totalUnits.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconPackage className="size-3.5 text-success" />
                  <span className="text-xs text-muted-foreground">
                    Valor inventario
                  </span>
                </div>
                <p className="text-xl font-bold">
                  {formatCurrency(totalValue)}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconAlertTriangle className="size-3.5 text-warning" />
                  <span className="text-xs text-muted-foreground">
                    Stock bajo
                  </span>
                </div>
                <p className="text-xl font-bold text-warning">
                  {lowStockCount}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <Card className="border-border/50 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <IconCircleMinus className="size-3.5 text-destructive" />
                  <span className="text-xs text-muted-foreground">
                    Sin stock
                  </span>
                </div>
                <p className="text-xl font-bold text-destructive">
                  {noStockCount}
                </p>
              </CardContent>
            </Card>
          </StaggerItem>
        </StaggerContainer>

        {/* Filters */}
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Inventario de productos
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar producto..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-full sm:w-44 text-xs">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {productCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="h-8 w-full sm:w-36 text-xs">
                  <SelectValue placeholder="Estado stock" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ok">Stock OK</SelectItem>
                  <SelectItem value="low">Stock bajo</SelectItem>
                  <SelectItem value="none">Sin stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                      Producto
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                      SKU
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                      Categoría
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9 text-center">
                      Stock
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9">
                      Nivel
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9 text-right">
                      Valor
                    </TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider h-9"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <p className="text-sm text-muted-foreground">
                          Sin resultados
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((product) => {
                      const status = getStockStatus(product);
                      const level =
                        product.minStock > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (product.stock / (product.minStock * 3)) * 100,
                              ),
                            )
                          : 100;

                      return (
                        <TableRow key={product.id}>
                          <TableCell className="py-2.5">
                            <p className="text-sm font-medium">
                              {product.name}
                            </p>
                          </TableCell>
                          <TableCell className="py-2.5 text-xs text-muted-foreground">
                            {product.sku}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <Badge variant="secondary" className="text-[10px]">
                              {product.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-xs font-semibold",
                                status === "ok" && "bg-success/10 text-success",
                                status === "low" &&
                                  "bg-warning/10 text-warning",
                                status === "none" &&
                                  "bg-destructive/10 text-destructive",
                              )}
                            >
                              {product.stock}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 w-32">
                            <div className="flex items-center gap-2">
                              <Progress
                                value={level}
                                className={cn(
                                  "h-1.5",
                                  status === "ok" && "[&>div]:bg-success",
                                  status === "low" && "[&>div]:bg-warning",
                                  status === "none" && "[&>div]:bg-destructive",
                                )}
                              />
                              <span className="text-[10px] text-muted-foreground w-6 text-right">
                                {level}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right text-sm font-medium tabular-nums">
                            {formatCurrency(product.stock * product.salePrice)}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                            >
                              Ajustar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}

