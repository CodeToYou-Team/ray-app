"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconPlus,
  IconTrash,
  IconPackage,
  IconTool,
  IconArrowsExchange,
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
import { createTransaction, updateTransaction } from "@/lib/finanzas/actions";
import {
  convertMoney,
  lineSubtotal,
  sumMoney,
  isMoney,
  isQuantity,
  isRate,
} from "@/lib/money";
import { formatMoney, formatDate } from "@/lib/format";
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

/** La tasa que el formulario propone para un par, y de dónde salió. */
export interface RateHint {
  rate: string;
  occurredOn: string;
  source: "configurada" | "ultima";
}

/** Un renglon tal como quedo guardado. */
export interface EditingItem {
  itemType: "product" | "service";
  refId: string;
  qty: string;
  /** En una venta, el precio CONGELADO. En una compra, lo que se pagó. */
  unitPrice: string;
}

/** Una operacion ya guardada, para precargar el formulario al corregirla. */
export interface EditingTransaction {
  id: string;
  kind: Kind;
  concept: string;
  occurredOn: string;
  categoryId: string;
  paymentMethodId: string;
  amount: string;
  notes: string | null;
  items: EditingItem[];
  /** La tasa con la que se registró, si hubo conversión. */
  exchangeRate: string | null;
  baseCurrency: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "ingreso" | "gasto";
  categories: FormOption[];
  paymentMethods: FormOption[];
  sellables: FormSellable[];
  /**
   * Lo ultimo que se pago por cada producto. Precarga el precio de compra; es
   * una sugerencia, no un valor fijo.
   */
  ultimoCosto?: Record<string, string>;
  /**
   * La última tasa usada para cada par de monedas, por clave "USD>VES".
   * Precarga el campo; es una sugerencia con fecha, no un valor fijo.
   */
  ultimaTasa?: Record<string, RateHint>;
  /**
   * Presente = corregir esa operacion en vez de registrar una nueva.
   *
   * El estado inicial se deriva de aqui una sola vez, asi que el padre monta el
   * formulario con `key` para que cambiar de fila lo vuelva a sembrar.
   */
  editing?: EditingTransaction;
}

interface Linea {
  key: string;
  refId: string;
  qty: string;
  /** Solo en compras: lo que se pagó por unidad, tecleado a mano. */
  unitPrice: string;
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
  ultimoCosto = {},
  ultimaTasa = {},
  editing,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>(editing?.kind ?? "operacion");
  const [concept, setConcept] = useState(editing?.concept ?? "");
  const [occurredOn, setOccurredOn] = useState(
    () => editing?.occurredOn ?? new Date().toISOString().slice(0, 10),
  );
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState(
    editing?.paymentMethodId ?? "",
  );
  const [amount, setAmount] = useState(
    editing && editing.kind === "operacion" ? editing.amount : "",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [rate, setRate] = useState(editing?.exchangeRate ?? "");
  const [lineas, setLineas] = useState<Linea[]>(() =>
    (editing?.items ?? []).map((i) => ({
      key: crypto.randomUUID(),
      refId: i.refId,
      qty: i.qty,
      unitPrice: i.unitPrice,
    })),
  );

  /**
   * Se genera una vez por apertura del formulario y viaja con el envio. Si el
   * usuario da doble tap, o la red reintenta, el servidor reconoce que es la
   * misma operacion y no la duplica.
   */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const currency = paymentMethods.find((m) => m.id === paymentMethodId)?.currency ?? null;
  const conRenglones = kind !== "operacion";

  /**
   * Qué se puede elegir como renglón.
   *
   * Una compra solo lleva productos; una venta, cualquier cosa del catálogo.
   *
   * Ya NO se filtra por moneda: antes solo aparecía lo que tuviera precio en la
   * moneda del pago, que es justo lo que hacía imposible vender en bolívares un
   * catálogo en dólares. Ahora se eligen igual y, si las monedas no coinciden,
   * se pide la tasa. Lo que sí sigue sin poder mezclarse es un producto en USD
   * con otro en VES en la misma operación: harían falta dos tasas y el total no
   * sería de ninguna de las dos monedas.
   */
  const porId = useMemo(
    () => new Map(sellables.map((s) => [s.id, s])),
    [sellables],
  );

  /**
   * En qué moneda están los precios de catálogo de lo que se eligió.
   *
   * `null` si no hay renglones todavía; si hay más de una, el servidor lo
   * rechaza (haría falta una tasa por moneda y el total no sería de ninguna).
   */
  const monedaPrecios = useMemo(() => {
    const monedas = new Set(
      lineas
        .map((l) => porId.get(l.refId)?.currency)
        .filter((c): c is string => Boolean(c)),
    );
    return monedas.size === 1 ? [...monedas][0] : null;
  }, [lineas, porId]);

  /**
   * Una compra no convierte nada: el costo se teclea ya en la moneda del pago.
   * En una venta, los precios salen del catálogo y hay que traerlos a la moneda
   * en que se cobra.
   */
  const necesitaTasa =
    kind === "venta" && Boolean(currency && monedaPrecios && monedaPrecios !== currency);

  /** El par que aplica ahora mismo, o "" si no hace falta convertir. */
  const par = necesitaTasa && monedaPrecios && currency ? `${monedaPrecios}>${currency}` : "";
  const sugerida = par ? ultimaTasa[par] : undefined;

  /**
   * El campo arranca con la última tasa que se usó para este par.
   *
   * Quien vende todo el día a la misma tasa no debería teclearla en cada
   * venta. Se ajusta durante el render y no en un efecto: React lo resuelve
   * antes de pintar, en vez de pintar vacío y volver a renderizar.
   *
   * Se dispara solo cuando CAMBIA el par, así que no pisa lo que la persona ya
   * escribió, y al corregir una operación respeta la tasa que tenía.
   */
  const [ultimoPar, setUltimoPar] = useState(par);
  if (par !== ultimoPar) {
    setUltimoPar(par);
    setRate(par ? (ultimaTasa[par]?.rate ?? "") : "");
  }

  const tasaOk = !necesitaTasa || isRate(rate);

  const disponibles = useMemo(() => {
    const base = kind === "compra" ? sellables.filter((s) => s.kind === "product") : sellables;
    // Elegida una moneda de precios, el resto se oculta en vez de dejar armar
    // una operación que el servidor va a rechazar al guardar.
    return monedaPrecios ? base.filter((s) => s.currency === monedaPrecios) : base;
  }, [sellables, kind, monedaPrecios]);

  /**
   * El precio CONGELADO de los renglones que ya estaban.
   *
   * Al corregir, el servidor conserva el precio con que se registro: subir la
   * lista hoy no revalua una venta de hace un mes. La vista previa usa el mismo
   * criterio para que el total que se ve sea el que se va a guardar. Un renglon
   * nuevo si toma el precio actual del catalogo.
   */
  const precioOriginal = useMemo(
    () => new Map((editing?.items ?? []).map((i) => [i.refId, i.unitPrice])),
    [editing],
  );

  /**
   * De donde sale el precio de un renglon.
   *
   * En una COMPRA lo escribe quien registra: el precio de venta de un producto
   * no es lo que costo reabastecerlo, y darlo por bueno inflaba el gasto con un
   * numero inventado. En una VENTA viene del catalogo y el servidor lo recalcula
   * igual — no se le cree al navegador el numero que suman los reportes.
   */
  function precioDe(linea: Linea): string | null {
    if (kind === "compra") return isMoney(linea.unitPrice) ? linea.unitPrice : null;

    const base = precioOriginal.get(linea.refId) ?? porId.get(linea.refId)?.price;
    if (!base) return null;
    // Si hay conversión, lo que se cobra es el precio ya convertido: la vista
    // previa tiene que mostrar el número que se va a guardar, no el de lista.
    if (!necesitaTasa) return base;
    if (!isRate(rate)) return null;
    try {
      return convertMoney(base, rate);
    } catch {
      return null;
    }
  }

  const subtotales = lineas.map((l) => {
    const price = precioDe(l);
    if (!price || !isQuantity(l.qty)) return "0.00";
    try {
      return lineSubtotal(l.qty, price);
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
    setRate("");
    setLineas([]);
    setError(null);
    setRequestId(crypto.randomUUID());
  }

  function close(next: boolean) {
    // Al corregir no se limpia: el padre monta el dialogo con `key`, asi que
    // cerrarlo lo desmonta y la proxima apertura siembra de cero.
    if (!next && !editing) reset();
    onOpenChange(next);
  }

  function submit() {
    setError(null);
    const comun = {
      concept,
      occurredOn,
      categoryId,
      paymentMethodId,
      amount: conRenglones ? undefined : amount,
      items: conRenglones
        ? lineas.map((l) => ({
            itemType: porId.get(l.refId)?.kind ?? ("product" as const),
            refId: l.refId,
            qty: l.qty,
            // Solo lo mira el servidor si es una compra; en una venta lo ignora.
            unitPrice: kind === "compra" ? l.unitPrice : undefined,
          }))
        : undefined,
      notes: notes || undefined,
      exchangeRate: necesitaTasa ? rate : undefined,
    };

    start(async () => {
      // Ni `type` ni `kind` viajan al corregir: el servidor conserva los suyos.
      // Volver una venta en gasto suelto no es cambiar un dato, es otra cosa.
      const result = editing
        ? await updateTransaction({ id: editing.id, ...comun })
        : await createTransaction({
            type,
            kind,
            ...comun,
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
      ? lineas.length > 0 &&
        lineas.every(
          (l) =>
            l.refId &&
            isQuantity(l.qty) &&
            // Una compra sin precio no se puede enviar: no hay de donde sacarlo.
            (kind !== "compra" || isMoney(l.unitPrice)),
        ) &&
        tasaOk
      : isMoney(amount));

  const opciones = kindsFor(type);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {editing
              ? "Corregir operación"
              : type === "ingreso"
                ? "Registrar ingreso"
                : "Registrar gasto"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {editing
              ? "Los ítems que ya estaban conservan el precio con que se registraron. El inventario se corrige con un movimiento de ajuste, sin borrar el original."
              : "El monto queda registrado en la moneda del método de pago. Los totales se llevan separados por moneda."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo de operación. Al corregir es un dato fijo, no una elección. */}
          {editing ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {opciones.find((o) => o.value === kind)?.label ?? kind}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                Para cambiar de tipo, anula esta operación y registra otra.
              </span>
            </div>
          ) : (
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
          )}

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
              precioDe={precioDe}
              ultimoCosto={ultimoCosto}
              subtotales={subtotales}
              total={totalRenglones}
              currency={currency}
              kind={kind}
            />
          )}

          {necesitaTasa && currency && monedaPrecios && (
            <TasaDeCambio
              rate={rate}
              setRate={setRate}
              base={monedaPrecios}
              currency={currency}
              sugerida={sugerida}
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
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tasa de cambio de la operación.
 *
 * Se teclea y se guarda con la operación: es la que regía cuando se vendió,
 * igual que el precio congelado del renglón. No se consulta a ningún servicio
 * ni se guarda un histórico de tasas — releer una venta de enero tiene que dar
 * siempre el mismo número.
 */
function TasaDeCambio({
  rate,
  setRate,
  base,
  currency,
  sugerida,
}: {
  rate: string;
  setRate: (v: string) => void;
  base: string;
  currency: string;
  sugerida?: RateHint;
}) {
  const valida = isRate(rate);
  // Si el campo trae la sugerencia tal cual, se dice de cuándo es. Una tasa de
  // hace una semana no se acepta a ciegas solo porque ya estaba escrita.
  const esLaSugerida = Boolean(sugerida && rate === sugerida.rate);

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <IconArrowsExchange className="size-4 text-primary" />
        <Label htmlFor="tasa" className="text-sm">
          Tasa de cambio
        </Label>
      </div>

      <p className="text-xs text-muted-foreground">
        Los precios están en {base} y estás cobrando en {currency}. Escribe la
        tasa que aplicaste: queda guardada con esta operación, no se vuelve a
        tocar.
      </p>

      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">1 {base} =</span>
        <Input
          id="tasa"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="0.000000"
          className="w-36 font-mono"
        />
        <span className="font-mono text-xs text-muted-foreground">{currency}</span>
      </div>

      {rate && !valida && (
        <p className="text-xs text-destructive">
          Usa un número mayor que cero, con hasta 6 decimales.
        </p>
      )}

      {esLaSugerida && sugerida && (
        <p className="text-[11px] text-muted-foreground">
          {sugerida.source === "configurada" ? (
            <>
              Es la que tienes fijada en Ajustes. Cámbiala aquí si hoy
              aplicaste otra: solo afecta a esta operación.
            </>
          ) : (
            <>
              Es la que usaste el {formatDate(sugerida.occurredOn)}. Cámbiala si
              hoy es otra.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function LineItemsEditor({
  lineas,
  setLineas,
  disponibles,
  porId,
  precioDe,
  ultimoCosto,
  subtotales,
  total,
  currency,
  kind,
}: {
  lineas: Linea[];
  setLineas: (l: Linea[]) => void;
  disponibles: FormSellable[];
  porId: Map<string, FormSellable>;
  precioDe: (linea: Linea) => string | null;
  ultimoCosto: Record<string, string>;
  subtotales: string[];
  total: string;
  currency: string | null;
  kind: Kind;
}) {
  const productos = disponibles.filter((d) => d.kind === "product");
  const servicios = disponibles.filter((d) => d.kind === "service");
  const esCompra = kind === "compra";

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
        <Label>
          {kind === "venta" ? "Qué se vendió" : "Qué se compró y a qué precio"}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disponibles.length === 0}
          onClick={() =>
            setLineas([
              ...lineas,
              { key: crypto.randomUUID(), refId: "", qty: "1", unitPrice: "" },
            ])
          }
        >
          <IconPlus className="size-3.5" />
          Agregar
        </Button>
      </div>

      {disponibles.length === 0 && (
        <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          {esCompra
            ? "No hay productos cargados todavía. Créalos primero para poder reabastecerlos."
            : `No hay productos ni servicios con precio en ${currency}. Créalos primero, o elige un método de pago en otra moneda.`}
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
                    lineas.map((x) =>
                      x.key === l.key
                        ? {
                            ...x,
                            refId: v,
                            // Lo que se pagó la última vez, como punto de
                            // partida. Si nunca se compró, queda en blanco:
                            // mejor vacío que el precio de venta, que es otro
                            // número y además uno creíble.
                            unitPrice: esCompra ? (ultimoCosto[v] ?? "") : "",
                          }
                        : x,
                    ),
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
                  {esCompra && !isMoney(l.unitPrice) ? (
                    <span>
                      Escribe cuánto costó cada uno
                      {ultimoCosto[l.refId] && (
                        <> (la última vez: {formatMoney(ultimoCosto[l.refId], currency)})</>
                      )}
                    </span>
                  ) : (
                    <>
                      {formatMoney(precioDe(l) ?? ref.price, currency)} ×{" "}
                      {l.qty || 0} ={" "}
                      <span className="font-medium text-foreground">
                        {formatMoney(subtotales[i] ?? "0", currency)}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>

            {/*
              En una compra el precio se teclea; en una venta sale del catálogo
              y mostrarlo editable sería mentir sobre lo que se puede cambiar.
            */}
            {esCompra && (
              <Input
                value={l.unitPrice}
                inputMode="decimal"
                className="w-24 font-mono"
                aria-label="Precio de compra"
                placeholder="Costo"
                onChange={(e) =>
                  setLineas(
                    lineas.map((x) =>
                      x.key === l.key ? { ...x, unitPrice: e.target.value } : x,
                    ),
                  )
                }
              />
            )}

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
