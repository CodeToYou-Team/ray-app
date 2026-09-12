"use client";

import { useState } from "react";
import {
  IconSearch,
  IconPackage,
  IconLayoutGrid,
  IconList,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function CatalogoProductosPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filtered = products.filter((p) => {
    if (!p.active) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    return true;
  });

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Catálogo de Productos</h2>
            <p className="text-sm text-muted-foreground">
              {filtered.length} producto{filtered.length !== 1 ? "s" : ""}{" "}
              disponible{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
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
            <div className="flex items-center border rounded-md">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="size-8 rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                <IconLayoutGrid className="size-3.5" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="size-8 rounded-l-none"
                onClick={() => setViewMode("list")}
              >
                <IconList className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <StaggerContainer
          className={cn(
            "gap-3",
            viewMode === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "flex flex-col",
          )}
        >
          {filtered.map((product) => {
            const stockStatus = getStockStatus(product);

            return (
              <StaggerItem key={product.id}>
                <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
                  <CardContent
                    className={cn(
                      "p-0",
                      viewMode === "list" && "flex items-center",
                    )}
                  >
                    {/* Image placeholder */}
                    <div
                      className={cn(
                        "bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center",
                        viewMode === "grid"
                          ? "h-36"
                          : "w-20 h-20 flex-shrink-0",
                      )}
                    >
                      <IconPackage
                        className={cn(
                          "text-primary/30",
                          viewMode === "grid" ? "size-12" : "size-8",
                        )}
                      />
                    </div>
                    <div
                      className={cn(
                        "p-4",
                        viewMode === "list" &&
                          "flex-1 flex items-center justify-between gap-4",
                      )}
                    >
                      <div className={viewMode === "list" ? "flex-1" : ""}>
                        <div className="flex items-start justify-between mb-1">
                          <h3 className="text-sm font-semibold line-clamp-1">
                            {product.name}
                          </h3>
                          {viewMode === "grid" && (
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px] ml-2 flex-shrink-0",
                                stockStatus === "ok" &&
                                  "bg-success/10 text-success",
                                stockStatus === "low" &&
                                  "bg-warning/10 text-warning",
                                stockStatus === "none" &&
                                  "bg-destructive/10 text-destructive",
                              )}
                            >
                              {stockStatus === "none"
                                ? "Sin stock"
                                : `${product.stock} uds`}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                          {product.description}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {product.category}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            SKU: {product.sku}
                          </span>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "flex items-center justify-between",
                          viewMode === "grid"
                            ? "mt-3 pt-3 border-t border-border/40"
                            : "gap-4 flex-shrink-0",
                        )}
                      >
                        <span className="text-base font-bold">
                          {formatCurrency(product.salePrice)}
                        </span>
                        {viewMode === "list" && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px]",
                              stockStatus === "ok" &&
                                "bg-success/10 text-success",
                              stockStatus === "low" &&
                                "bg-warning/10 text-warning",
                              stockStatus === "none" &&
                                "bg-destructive/10 text-destructive",
                            )}
                          >
                            {stockStatus === "none"
                              ? "Sin stock"
                              : `${product.stock} uds`}
                          </Badge>
                        )}
                        {viewMode === "grid" && (
                          <span className="text-xs text-muted-foreground">
                            Compra: {formatCurrency(product.purchasePrice)}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </StaggerItem>
            );
          })}
        </StaggerContainer>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <IconPackage className="size-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              No se encontraron productos
            </p>
          </div>
        )}
      </div>
    </PageTransition>
  );
}

