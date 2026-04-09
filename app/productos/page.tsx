"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconPlus,
  IconSearch,
  IconPackage,
  IconBriefcase,
  IconLayoutGrid,
  IconList,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PageTransition,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion";
import {
  products,
  services,
  productCategories,
  serviceCategories,
  formatCurrency,
  getStockStatus,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export default function ProductosPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredProducts = products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    return true;
  });

  const filteredServices = services.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    return true;
  });

  return (
    <PageTransition>
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Productos y Servicios</h2>
            <p className="text-sm text-muted-foreground">
              Gestiona tu catálogo completo de productos y servicios
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" asChild>
              <Link href="/productos/servicios/nuevo">
                <IconBriefcase className="size-3.5" />
                Nuevo servicio
              </Link>
            </Button>
            <Button size="sm" className="gap-1.5" asChild>
              <Link href="/productos/nuevo">
                <IconPlus className="size-3.5" />
                Nuevo producto
              </Link>
            </Button>
          </div>
        </div>

        <Tabs defaultValue="productos" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <TabsList className="h-9">
              <TabsTrigger value="productos" className="text-xs gap-1.5">
                <IconPackage className="size-3.5" />
                Productos ({products.length})
              </TabsTrigger>
              <TabsTrigger value="servicios" className="text-xs gap-1.5">
                <IconBriefcase className="size-3.5" />
                Servicios ({services.length})
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-56">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
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

          {/* Products Tab */}
          <TabsContent value="productos" className="mt-0">
            <div className="flex items-center gap-2 mb-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {productCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {viewMode === "grid" ? (
              <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredProducts.map((product) => {
                  const stockStatus = getStockStatus(product);
                  return (
                    <StaggerItem key={product.id}>
                      <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow group">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <IconPackage className="size-5" />
                            </div>
                            <Badge
                              variant={product.active ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {product.active ? "Activo" : "Inactivo"}
                            </Badge>
                          </div>
                          <h3 className="text-sm font-semibold mb-1 line-clamp-1">
                            {product.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                            {product.description}
                          </p>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-base">
                              {formatCurrency(product.salePrice)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px] font-medium",
                                stockStatus === "ok" &&
                                  "bg-success/10 text-success",
                                stockStatus === "low" &&
                                  "bg-warning/10 text-warning",
                                stockStatus === "none" &&
                                  "bg-destructive/10 text-destructive",
                              )}
                            >
                              Stock: {product.stock}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
                            <span className="text-[10px] text-muted-foreground">
                              SKU: {product.sku}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              asChild
                            >
                              <Link href={`/productos/${product.id}/editar`}>
                                Editar
                              </Link>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>
            ) : (
              <Card className="border-border/50 shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[11px] uppercase tracking-wider">
                        Producto
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider">
                        SKU
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider">
                        Categoría
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-right">
                        Precio
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-center">
                        Stock
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider text-center">
                        Estado
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-wider"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => {
                      const stockStatus = getStockStatus(product);
                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">
                                {product.name}
                              </p>
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {product.description}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {product.sku}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">
                              {product.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">
                            {formatCurrency(product.salePrice)}
                          </TableCell>
                          <TableCell className="text-center">
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
                              {product.stock}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={product.active ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {product.active ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              asChild
                            >
                              <Link href={`/productos/${product.id}/editar`}>
                                Editar
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}

            {filteredProducts.length === 0 && (
              <div className="text-center py-12">
                <IconPackage className="size-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium text-muted-foreground">
                  No se encontraron productos
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ajusta los filtros o crea un nuevo producto
                </p>
              </div>
            )}
          </TabsContent>

          {/* Services Tab */}
          <TabsContent value="servicios" className="mt-0">
            <div className="flex items-center gap-2 mb-3">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las categorías</SelectItem>
                  {serviceCategories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredServices.map((service) => (
                <StaggerItem key={service.id}>
                  <Card className="border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-info/10 text-info">
                          <IconBriefcase className="size-5" />
                        </div>
                        <Badge
                          variant={service.active ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {service.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                      <h3 className="text-sm font-semibold mb-1">
                        {service.name}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                        {service.description}
                      </p>
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-bold text-base">
                          {formatCurrency(service.price)}
                        </span>
                        {service.duration && (
                          <Badge variant="secondary" className="text-[10px]">
                            {service.duration}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-border/40">
                        <Badge variant="secondary" className="text-[10px]">
                          {service.category}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          asChild
                        >
                          <Link
                            href={`/productos/servicios/${service.id}/editar`}
                          >
                            Editar
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </StaggerItem>
              ))}
            </StaggerContainer>

            {filteredServices.length === 0 && (
              <div className="text-center py-12">
                <IconBriefcase className="size-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium text-muted-foreground">
                  No se encontraron servicios
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ajusta los filtros o crea un nuevo servicio
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageTransition>
  );
}

