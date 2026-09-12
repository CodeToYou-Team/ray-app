"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconPlus,
  IconTrash,
  IconPackage,
  IconTool,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createTransaction } from "@/lib/finanzas/actions";
import { lineSubtotal, sumMoney, isMoney, isQuantity } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FormOption {
  id: string;
  label: string;
  currency?: string | null;
}

export interface FormSellable {
  id: string;
  name: string;
  price: string;
  currency: string;
  kind: "product" | "service";
}

type Kind = "operacion" | "venta" | "compra";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "ingreso" | "gasto";
  categories: FormOption[];
  paymentMethods: FormOption[];
  sellables: FormSellable[];
}

interface Linea {
  key: string;
  refId: string;
  qty: string;
}

/** Un ingreso vende; un gasto compra. */
function kindsFor(type: "ingreso" | "gasto"): { value: Kind; label: string; hint: string }[] {
  return [
    {
      value: "operacion",
      label: "Operación suelta",
      hint: "Escribes el monto directo. No toca el inventario.",
    },
    type === "ingreso"
      ? {
          value: "venta",
          label: "Venta",
          hint: "Eliges productos o servicios. Descuenta del inventario.",
        }
      : {
          value: "compra",
          label: "Compra de insumos",
          hint: "Eliges productos. Suma al inventario.",
        },
  ];
}

export function TransactionForm({
  open,
  onOpenChange,
  type,
  categories,
  paymentMethods,
  sellables,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>("operacion");
  const [concept, setConcept] = useState("");
  const [occurredOn, setOccurredOn] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  /**
   * Se genera una vez por apertura del formulario y viaja con el envio. Si el
   * usuario da doble tap, o la red reintenta, el servidor reconoce que es la
   * misma operacion y no la duplica.
   */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const currency = paymentMethods.find((m) => m.id === paymentMethodId)?.currency ?? null;
  const conRenglones = kind !== "operacion";

  /**
   * Solo se ofrecen items en la moneda del pago. Sumar un producto con precio
   * en USD dentro de una venta cobrada en Bs daria un total sin significado,
   * porque no se convierte nada entre monedas.
   */
  const disponibles = useMemo(() => {
    const base = sellables.filter((s) => !currency || s.currency === currency);
    // Una compra de insumos no lleva servicios.
    return kind === "compra" ? base.filter((s) => s.kind === "product") : base;
  }, [sellables, currency, kind]);

  const porId = useMemo(
    () => new Map(sellables.map((s) => [s.id, s])),
    [sellables],
  );

  const subtotales = lineas.map((l) => {
    const ref = porId.get(l.refId);
    if (!ref || !isQuantity(l.qty)) return "0.00";
    try {
      return lineSubtotal(l.qty, ref.price);
    } catch {
      return "0.00";
    }
  });
  const totalRenglones = sumMoney(subtotales);

  function reset() {
    setKind("operacion");
    setConcept("");
    setOccurredOn(new Date().toISOString().slice(0, 10));
    setCategoryId("");
    setPaymentMethodId("");
    setAmount("");
    setNotes("");
    setLineas([]);
    setError(null);
    setRequestId(crypto.randomUUID());
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await createTransaction({
        type,
        kind,
        concept,
        occurredOn,
        categoryId,
        paymentMethodId,
        amount: conRenglones ? undefined : amount,
        items: conRenglones
          ? lineas.map((l) => ({
              itemType: porId.get(l.refId)?.kind ?? "product",
              refId: l.refId,
              qty: l.qty,
            }))
          : undefined,
        notes: notes || undefined,
        clientRequestId: requestId,
      });

      if (result.ok) {
        close(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const puedeEnviar =
    concept.trim() &&
    categoryId &&
    paymentMethodId &&
    (conRenglones
      ? lineas.length > 0 && lineas.every((l) => l.refId && isQuantity(l.qty))
      : isMoney(amount));

  const opciones = kindsFor(type);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {type === "ingreso" ? "Registrar ingreso" : "Registrar gasto"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            El monto queda registrado en la moneda del método de pago. Los totales
            se llevan separados por moneda.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo de operación */}
          <div className="space-y-2">
            <Label>Tipo de operación</Label>
            <div className="grid grid-cols-2 gap-2">
              {opciones.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    setKind(o.value);
                    setLineas([]);
                  }}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    kind === o.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                    {o.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="concept">Concepto</Label>
              <Input
                id="concept"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder={type === "ingreso" ? "Venta del día" : "Compra de insumos"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="occurredOn">Fecha</Label>
              <Input
                id="occurredOn"
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            </div>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment">Método de pago</Label>
              <Select
                value={paymentMethodId}
                onValueChange={(v) => {
                  setPaymentMethodId(v);
                  // La moneda cambia: los renglones elegidos pueden ya no aplicar.
                  setLineas([]);
                }}
              >
                <SelectTrigger id="payment" className="w-full">
                  <SelectValue placeholder="Elige uno" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {m.currency}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Monto o renglones */}
          {!conRenglones ? (
            <div className="space-y-2">
              <Label htmlFor="amount">Monto</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="font-mono"
                />
                <Badge variant="outline" className="shrink-0 font-mono">
                  {currency ?? "—"}
                </Badge>
              </div>
              {amount && !isMoney(amount) && (
                <p className="text-xs text-destructive">
                  Usa números con hasta 2 decimales.
                </p>
              )}
            </div>
          ) : (
            <LineItemsEditor
              lineas={lineas}
              setLineas={setLineas}
              disponibles={disponibles}
              porId={porId}
              subtotales={subtotales}
              total={totalRenglones}
              currency={currency}
              kind={kind}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
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
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !puedeEnviar}>
            {pending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineItemsEditor({
  lineas,
  setLineas,
  disponibles,
  porId,
  subtotales,
  total,
  currency,
  kind,
}: {
  lineas: Linea[];
  setLineas: (l: Linea[]) => void;
  disponibles: FormSellable[];
  porId: Map<string, FormSellable>;
  subtotales: string[];
  total: string;
  currency: string | null;
  kind: Kind;
}) {
  const productos = disponibles.filter((d) => d.kind === "product");
  const servicios = disponibles.filter((d) => d.kind === "service");

  if (!currency) {
    return (
      <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        Elige primero el método de pago: define la moneda, y solo se pueden
        agregar productos con precio en esa misma moneda.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{kind === "venta" ? "Qué se vendió" : "Qué se compró"}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disponibles.length === 0}
          onClick={() =>
            setLineas([
              ...lineas,
              { key: crypto.randomUUID(), refId: "", qty: "1" },
            ])
          }
        >
          <IconPlus className="size-3.5" />
          Agregar
        </Button>
      </div>

      {disponibles.length === 0 && (
        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          No hay {kind === "compra" ? "productos" : "productos ni servicios"} con
          precio en {currency}. Créalos primero, o elige un método de pago en otra
          moneda.
        </p>
      )}

      {lineas.map((l, i) => {
        const ref = porId.get(l.refId);
        return (
          <div key={l.key} className="flex items-start gap-2">
            <div className="flex-1">
              <Select
                value={l.refId}
                onValueChange={(v) =>
                  setLineas(
                    lineas.map((x) => (x.key === l.key ? { ...x, refId: v } : x)),
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elige un ítem" />
                </SelectTrigger>
                <SelectContent>
                  {productos.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5">
                        <IconPackage className="size-3.5" /> Productos
                      </SelectLabel>
                      {productos.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            {p.price}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {servicios.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5">
                        <IconTool className="size-3.5" /> Servicios
                      </SelectLabel>
                      {servicios.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                            {s.price}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {ref && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatMoney(ref.price, ref.currency)} × {l.qty || 0} ={" "}
                  <span className="font-medium text-foreground">
                    {formatMoney(subtotales[i] ?? "0", currency)}
                  </span>
                </p>
              )}
            </div>

            <Input
              value={l.qty}
              inputMode="decimal"
              className="w-20 font-mono"
              aria-label="Cantidad"
              onChange={(e) =>
                setLineas(
                  lineas.map((x) =>
                    x.key === l.key ? { ...x, qty: e.target.value } : x,
                  ),
                )
              }
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={() => setLineas(lineas.filter((x) => x.key !== l.key))}
            >
              <IconTrash className="size-4" />
              <span className="sr-only">Quitar renglón</span>
            </Button>
          </div>
        );
      })}

      {lineas.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Total (lo calcula el servidor al guardar)
          </span>
          <span className="font-mono text-sm font-semibold">
            {formatMoney(total, currency)}
          </span>
        </div>
      )}
    </div>
  );
}
