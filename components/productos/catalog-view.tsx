"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconPlus,
  IconPencil,
  IconArchive,
  IconArchiveOff,
  IconAlertCircle,
  IconSearch,
  IconAdjustments,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  createProduct,
  editProduct,
  setProductArchived,
  adjustStock,
  createService,
  editService,
  setServiceArchived,
} from "@/lib/productos/actions";
import {
  PRIMARY_CURRENCIES,
  STABLECOINS,
  OTHER_CURRENCIES,
} from "@/lib/currencies";
import { formatMoney } from "@/lib/format";
import { isMoney, isQuantity } from "@/lib/money";
import { cn } from "@/lib/utils";
import { FieldInput, formatFieldValue } from "@/components/fields/field-input";
import { customFields, tableFields } from "@/lib/fields/resolve";
import type { ResolvedField } from "@/lib/fields/resolve";
import { toFormValues } from "@/lib/fields/validate";

export interface ProductRow {
  id: string;
  /** Valores de las columnas personalizadas, por clave inmutable. */
  custom?: Record<string, unknown>;
  name: string;
  sku: string | null;
  categoryId: string;
  categoryLabel: string;
  price: string;
  currency: string;
  minStock: string | null;
  isActive: boolean;
  archived: boolean;
  stock: string;
}

export interface ServiceRow {
  id: string;
  custom?: Record<string, unknown>;
  name: string;
  categoryId: string;
  categoryLabel: string;
  price: string;
  currency: string;
  isActive: boolean;
  archived: boolean;
}

export interface CategoryOption {
  id: string;
  label: string;
}

interface Props {
  products: ProductRow[];
  services: ServiceRow[];
  productCategories: CategoryOption[];
  serviceCategories: CategoryOption[];
  defaultCurrency: string;
  canManage: boolean;
  canAdjustStock: boolean;
  /** Columnas resueltas: las fijas del codigo mas las que configuro el cliente. */
  productFields: ResolvedField[];
  serviceFields: ResolvedField[];
}

/** "7.000" -> "7", "1.500" -> "1.5". */
function cantidad(value: string): string {
  return value.replace(/\.?0+$/, "") || "0";
}

type Editing =
  | { tab: "productos"; row: ProductRow | null }
  | { tab: "servicios"; row: ServiceRow | null };

export function CatalogView({
  products,
  services,
  productCategories,
  serviceCategories,
  defaultCurrency,
  canManage,
  canAdjustStock,
  productFields,
  serviceFields,
}: Props) {
  const [tab, setTab] = useState<"productos" | "servicios">("productos");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adjusting, setAdjusting] = useState<ProductRow | null>(null);

  const q = search.trim().toLowerCase();
  const filtrar = <T extends { name: string; archived: boolean }>(rows: T[]) =>
    rows.filter(
      (r) =>
        (showArchived || !r.archived) &&
        (!q || r.name.toLowerCase().includes(q)),
    );

  const visiblesProductos = filtrar(products);
  const visiblesServicios = filtrar(services);

  // Solo las personalizadas marcadas para la tabla: las fijas ya tienen su
  // columna escrita a mano, con su formato propio.
  const columnasProducto = tableFields(customFields(productFields));
  const columnasServicio = tableFields(customFields(serviceFields));

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Productos y servicios</h2>
          <p className="text-sm text-muted-foreground">
            Lo que vendes. Los productos llevan inventario; los servicios no.
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setEditing({ tab, row: null } as Editing)}
          >
            <IconPlus className="size-3.5" />
            {tab === "productos" ? "Nuevo producto" : "Nuevo servicio"}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="productos" className="text-xs">
              Productos ({products.filter((p) => !p.archived).length})
            </TabsTrigger>
            <TabsTrigger value="servicios" className="text-xs">
              Servicios ({services.filter((s) => !s.archived).length})
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-3">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar…"
                className="h-9 w-48 pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="ver-archivados"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              <Label htmlFor="ver-archivados" className="text-xs font-normal">
                Archivados
              </Label>
            </div>
          </div>
        </div>

        <TabsContent value="productos" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="w-28">SKU</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="w-28 text-right">Precio</TableHead>
                    <TableHead className="w-20 text-right">Stock</TableHead>
                    {/* Una columna por cada campo personalizado visible. */}
                    {columnasProducto.map((f) => (
                      <TableHead key={f.key}>{f.label}</TableHead>
                    ))}
                    {canManage && <TableHead className="w-24 text-right" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblesProductos.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6 + columnasProducto.length}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {products.length === 0
                          ? "Todavía no hay productos. Crea el primero para poder registrar ventas."
                          : "Ninguno coincide con la búsqueda."}
                      </TableCell>
                    </TableRow>
                  )}
                  {visiblesProductos.map((p) => (
                    <TableRow
                      key={p.id}
                      className={p.archived ? "opacity-55" : undefined}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {p.name}
                          {p.archived && (
                            <Badge variant="secondary" className="text-[10px]">
                              Archivado
                            </Badge>
                          )}
                          {!p.isActive && !p.archived && (
                            <Badge variant="outline" className="text-[10px]">
                              Inactivo
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.sku ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.categoryLabel}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoney(p.price, p.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "font-mono text-sm",
                            Number(p.stock) <= 0 && "text-destructive",
                            p.minStock &&
                              Number(p.stock) > 0 &&
                              Number(p.stock) <= Number(p.minStock) &&
                              "text-warning",
                          )}
                        >
                          {cantidad(p.stock)}
                        </span>
                      </TableCell>
                      {columnasProducto.map((f) => (
                        <TableCell key={f.key} className="text-sm text-muted-foreground">
                          {formatFieldValue(f, p.custom?.[f.key])}
                        </TableCell>
                      ))}
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canAdjustStock && !p.archived && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                title="Ajustar inventario"
                                onClick={() => setAdjusting(p)}
                              >
                                <IconAdjustments className="size-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() =>
                                setEditing({ tab: "productos", row: p })
                              }
                            >
                              <IconPencil className="size-4" />
                            </Button>
                            <ArchiveButton
                              archived={p.archived}
                              onToggle={() =>
                                setProductArchived(p.id, !p.archived)
                              }
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="servicios" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="w-28 text-right">Precio</TableHead>
                    {columnasServicio.map((f) => (
                      <TableHead key={f.key}>{f.label}</TableHead>
                    ))}
                    {canManage && <TableHead className="w-20 text-right" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblesServicios.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4 + columnasServicio.length}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {services.length === 0
                          ? "Todavía no hay servicios."
                          : "Ninguno coincide con la búsqueda."}
                      </TableCell>
                    </TableRow>
                  )}
                  {visiblesServicios.map((s) => (
                    <TableRow
                      key={s.id}
                      className={s.archived ? "opacity-55" : undefined}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {s.name}
                          {s.archived && (
                            <Badge variant="secondary" className="text-[10px]">
                              Archivado
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.categoryLabel}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoney(s.price, s.currency)}
                      </TableCell>
                      {columnasServicio.map((f) => (
                        <TableCell key={f.key} className="text-sm text-muted-foreground">
                          {formatFieldValue(f, s.custom?.[f.key])}
                        </TableCell>
                      ))}
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() =>
                                setEditing({ tab: "servicios", row: s })
                              }
                            >
                              <IconPencil className="size-4" />
                            </Button>
                            <ArchiveButton
                              archived={s.archived}
                              onToggle={() =>
                                setServiceArchived(s.id, !s.archived)
                              }
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editing && (
        <ItemDialog
          editing={editing}
          categories={
            editing.tab === "productos" ? productCategories : serviceCategories
          }
          fields={
            editing.tab === "productos" ? productFields : serviceFields
          }
          defaultCurrency={defaultCurrency}
          onClose={() => setEditing(null)}
        />
      )}

      {adjusting && (
        <AdjustDialog product={adjusting} onClose={() => setAdjusting(null)} />
      )}
    </div>
  );
}

function ArchiveButton({
  archived,
  onToggle,
}: {
  archived: boolean;
  onToggle: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={pending}
      title={archived ? "Restaurar" : "Archivar"}
      onClick={() =>
        start(async () => {
          await onToggle();
          router.refresh();
        })
      }
    >
      {archived ? (
        <IconArchiveOff className="size-4" />
      ) : (
        <IconArchive className="size-4" />
      )}
    </Button>
  );
}

function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Moneda" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Frecuentes</SelectLabel>
          {PRIMARY_CURRENCIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Stablecoins</SelectLabel>
          {STABLECOINS.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Otras</SelectLabel>
          {OTHER_CURRENCIES.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="font-mono text-xs">{c.code}</span>
              <span className="text-muted-foreground"> · {c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function ItemDialog({
  editing,
  categories,
  fields,
  defaultCurrency,
  onClose,
}: {
  editing: Editing;
  categories: CategoryOption[];
  fields: ResolvedField[];
  defaultCurrency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const esProducto = editing.tab === "productos";
  const row = editing.row;
  const producto = esProducto ? (row as ProductRow | null) : null;

  const [name, setName] = useState(row?.name ?? "");
  const [sku, setSku] = useState(producto?.sku ?? "");
  const [categoryId, setCategoryId] = useState(row?.categoryId ?? "");
  const [price, setPrice] = useState(row?.price ?? "");
  const [currency, setCurrency] = useState(row?.currency ?? defaultCurrency);
  const [minStock, setMinStock] = useState(producto?.minStock ?? "");
  const [initialStock, setInitialStock] = useState("");
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const personalizados = customFields(fields);
  /**
   * `toFormValues` no valida a proposito: un valor que hoy seria invalido (una
   * opcion archivada, un campo que ahora es requerido) se muestra igual, porque
   * era valido cuando se escribio.
   */
  const [custom, setCustom] = useState(() =>
    toFormValues(personalizados, row?.custom),
  );

  function submit() {
    setError(null);
    start(async () => {
      const base = {
        name,
        categoryId,
        price,
        currency,
        isActive,
        custom,
      };
      const result = esProducto
        ? row
          ? await editProduct(row.id, {
              ...base,
              sku: sku || undefined,
              minStock: minStock || undefined,
            })
          : await createProduct({
              ...base,
              sku: sku || undefined,
              minStock: minStock || undefined,
              initialStock: initialStock || undefined,
            })
        : row
          ? await editService(row.id, base)
          : await createService(base);

      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const titulo = row
    ? `Editar ${esProducto ? "producto" : "servicio"}`
    : `Nuevo ${esProducto ? "producto" : "servicio"}`;

  const puedeEnviar = name.trim() && categoryId && isMoney(price);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{titulo}</DialogTitle>
          <DialogDescription className="text-xs">
            El precio queda en la moneda que elijas. Solo se puede vender en una
            operación cobrada en esa misma moneda: los montos no se convierten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="category" className="w-full">
                  <SelectValue placeholder="Elige una" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay categorías. Créalas en Ajustes.
                </p>
              )}
            </div>

            {esProducto && (
              <div className="space-y-2">
                <Label htmlFor="sku">SKU (opcional)</Label>
                <Input
                  id="sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="font-mono"
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="price">Precio</Label>
              <Input
                id="price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
              {price && !isMoney(price) && (
                <p className="text-xs text-destructive">
                  Usa números con hasta 2 decimales.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <CurrencySelect value={currency} onChange={setCurrency} />
            </div>
          </div>

          {esProducto && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="minStock">Stock mínimo (opcional)</Label>
                <Input
                  id="minStock"
                  inputMode="decimal"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="—"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Por debajo de esto aparece como stock bajo.
                </p>
              </div>

              {!row && (
                <div className="space-y-2">
                  <Label htmlFor="initialStock">Stock inicial</Label>
                  <Input
                    id="initialStock"
                    inputMode="decimal"
                    value={initialStock}
                    onChange={(e) => setInitialStock(e.target.value)}
                    placeholder="0"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se registra como un movimiento, no como un número suelto.
                  </p>
                </div>
              )}
            </div>
          )}

          {personalizados.length > 0 && (
            <div className="space-y-4 border-t pt-4">
              {personalizados.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={custom[f.key]}
                  onChange={(v) => setCustom({ ...custom, [f.key]: v })}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch id="isActive" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="isActive" className="text-sm font-normal">
              Disponible para vender
            </Label>
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <IconAlertCircle className="mt-px size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !puedeEnviar}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ajuste de inventario.
 *
 * Se pide la DIFERENCIA, no el stock final: el movimiento es lo que explica el
 * cambio, y fijar un valor absoluto borraria esa explicacion.
 */
function AdjustDialog({
  product,
  onClose,
}: {
  product: ProductRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"ajuste" | "merma">("ajuste");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const resultado =
    delta && isQuantity(delta)
      ? Number(product.stock) + Number(delta)
      : Number(product.stock);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Ajustar inventario</DialogTitle>
          <DialogDescription className="text-xs">
            {product.name} · stock actual {cantidad(product.stock)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delta">Diferencia</Label>
            <Input
              id="delta"
              inputMode="decimal"
              value={delta}
              autoFocus
              onChange={(e) => setDelta(e.target.value)}
              placeholder="Ej: 5 para sumar, -2 para restar"
              className="font-mono"
            />
            {delta && isQuantity(delta) && (
              <p className="text-xs text-muted-foreground">
                El stock quedaría en{" "}
                <span className="font-mono font-medium text-foreground">
                  {resultado}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Motivo</Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as typeof reason)}
            >
              <SelectTrigger id="reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ajuste">Ajuste por conteo físico</SelectItem>
                <SelectItem value="merma">Merma o daño</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Nota (opcional)</Label>
            <Textarea
              id="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <IconAlertCircle className="mt-px size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              setError(null);
              start(async () => {
                const result = await adjustStock({
                  productId: product.id,
                  delta,
                  reason,
                  note: note || undefined,
                });
                if (result.ok) {
                  onClose();
                  router.refresh();
                } else setError(result.error);
              });
            }}
            disabled={pending || !delta || !isQuantity(delta)}
          >
            {pending ? "Guardando…" : "Registrar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
