"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  ArchiveButton,
  etiqueta,
  ItemDialog,
  type CategoryOption,
  type ServiceRow,
} from "@/components/productos/catalog-view";
import { formatFieldValue } from "@/components/fields/field-input";
import { configureServiceBooking, setResourceLabel } from "@/lib/reservas/actions";
import { setServiceArchived } from "@/lib/productos/actions";
import { customFields, tableFields, type ResolvedField } from "@/lib/fields/resolve";
import { formatMoney } from "@/lib/format";
import type { Unidad } from "@/lib/reservas/rango";
import { TEXTO_UNIDAD } from "./seccion-reserva";

/** Lo que el listado resume de cómo se reserva cada servicio. */
export interface ResumenReserva {
  unidad: Unidad | null;
  recursos: number;
  tarifas: number;
}

const SIN_RESERVA = "no";

/**
 * El catálogo de servicios, con la misma forma que el de productos: datos en
 * columnas y las acciones al final. El lápiz lleva a la página del servicio,
 * donde se edita todo (datos, cómo se reserva, tarifas, recursos, horario).
 */
export function ServicesView({
  services,
  reservas,
  categories,
  defaultCurrency,
  canManage,
  canSetup,
  fields,
}: {
  services: ServiceRow[];
  /** Por id de servicio. Los archivados no están. */
  reservas: Record<string, ResumenReserva>;
  categories: CategoryOption[];
  defaultCurrency: string;
  canManage: boolean;
  canSetup: boolean;
  fields: ResolvedField[];
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creando, setCreando] = useState(false);

  const q = search.trim().toLowerCase();
  const visibles = services.filter(
    (s) => (showArchived || !s.archived) && (!q || s.name.toLowerCase().includes(q)),
  );
  const columnas = tableFields(customFields(fields));
  // Editar es abrir la página: sirve tanto a quien edita los datos como a
  // quien configura las reservas.
  const conAcciones = canManage || canSetup;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Servicios"
          description="Lo que vendes sin inventario. Abre uno para ver cómo se reserva, sus tarifas, recursos y horario."
          className="min-w-0 flex-1"
        />
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setCreando(true)}>
            <Plus className="size-3.5" />
            Nuevo servicio
          </Button>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="h-9 w-48 pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="ver-archivados" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="ver-archivados" className="text-xs font-normal">
            Archivados
          </Label>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead>{etiqueta(fields, "category_id", "Categoría")}</TableHead>
                <TableHead>Reserva</TableHead>
                <TableHead className="w-28 text-right">{etiqueta(fields, "price", "Precio")}</TableHead>
                {columnas.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                {conAcciones && <TableHead className="w-24 text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={(conAcciones ? 5 : 4) + columnas.length}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {services.length === 0
                      ? "Todavía no hay servicios. Crea el primero, por ejemplo “Habitación doble” o “Alquiler de cancha”."
                      : "Ninguno coincide con la búsqueda."}
                  </TableCell>
                </TableRow>
              )}
              {visibles.map((s) => (
                <TableRow key={s.id} className={s.archived ? "opacity-55" : undefined}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/servicios/${s.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.archived && (
                        <Badge variant="secondary" className="text-[10px]">
                          Archivado
                        </Badge>
                      )}
                      {!s.isActive && !s.archived && (
                        <Badge variant="outline" className="text-[10px]">
                          Inactivo
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.categoryLabel}</TableCell>
                  <TableCell className="text-sm">
                    <ResumenCelda resumen={reservas[s.id]} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatMoney(s.price, s.currency)}
                  </TableCell>
                  {columnas.map((f) => (
                    <TableCell key={f.key} className="text-sm text-muted-foreground">
                      {formatFieldValue(f, s.custom?.[f.key])}
                    </TableCell>
                  ))}
                  {conAcciones && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Editar"
                          asChild
                        >
                          <Link href={`/servicios/${s.id}`}>
                            <Pencil className="size-4" />
                            <span className="sr-only">Editar {s.name}</span>
                          </Link>
                        </Button>
                        {canManage && (
                          <ArchiveButton
                            archived={s.archived}
                            onToggle={() => setServiceArchived(s.id, !s.archived)}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creando && (
        <NuevoServicio
          categories={categories}
          fields={fields}
          defaultCurrency={defaultCurrency}
          canSetup={canSetup}
          onClose={() => setCreando(false)}
        />
      )}
    </div>
  );
}

function ResumenCelda({ resumen }: { resumen?: ResumenReserva }) {
  if (!resumen?.unidad) return <span className="text-muted-foreground">No se reserva</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {TEXTO_UNIDAD[resumen.unidad]}
      <span className="text-muted-foreground">·</span>
      {resumen.recursos === 0 ? (
        <span className="text-warning">sin recursos</span>
      ) : (
        <span className="text-muted-foreground">
          {resumen.recursos} {resumen.recursos === 1 ? "recurso" : "recursos"}
        </span>
      )}
    </span>
  );
}

/**
 * Crear un servicio. Si el rol puede configurar reservas, pregunta de entrada
 * si se reserva; al guardar lleva a su página, que es donde se agregan los
 * recursos. Antes se creaba aquí y se configuraba en otra pantalla sin aviso.
 */
function NuevoServicio({
  categories,
  fields,
  defaultCurrency,
  canSetup,
  onClose,
}: {
  categories: CategoryOption[];
  fields: ResolvedField[];
  defaultCurrency: string;
  canSetup: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [unidad, setUnidad] = useState<Unidad | null>(null);
  const [compartido, setCompartido] = useState(false);
  const [nombreRecursos, setNombreRecursos] = useState("");

  async function despuesDeCrear(id: string) {
    // El servicio ya existe. Si falla esto, se configura en su página: no
    // vale la pena deshacer el alta por eso.
    if (unidad) {
      const r = await configureServiceBooking({ serviceId: id, unidad, compartido });
      if (r.ok && nombreRecursos.trim()) {
        await setResourceLabel({ serviceId: id, label: nombreRecursos });
      }
    }
    // Reservable: lo que falta son sus recursos, así que abre esa pestaña.
    router.push(unidad ? `/servicios/${id}?tab=recursos` : `/servicios/${id}`);
  }

  return (
    <ItemDialog
      editing={{ tab: "servicios", row: null }}
      categories={categories}
      fields={fields}
      defaultCurrency={defaultCurrency}
      onClose={onClose}
      onSaved={despuesDeCrear}
    >
      {canSetup && (
        <div className="space-y-4 border-t pt-4">
          <div className="space-y-2">
            <Label htmlFor="n-reserva">¿Se reserva?</Label>
            <Select
              value={unidad ?? SIN_RESERVA}
              onValueChange={(v) => setUnidad(v === SIN_RESERVA ? null : (v as Unidad))}
            >
              <SelectTrigger id="n-reserva" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_RESERVA}>No, solo se vende</SelectItem>
                <SelectItem value="noche">Sí, por fechas (habitaciones, cabañas)</SelectItem>
                <SelectItem value="hora">Sí, por horas (canchas, salas, clases)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {unidad && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="n-nombre">¿Cómo se llaman sus recursos?</Label>
                <Input
                  id="n-nombre"
                  value={nombreRecursos}
                  onChange={(e) => setNombreRecursos(e.target.value)}
                  placeholder={unidad === "noche" ? "Habitación" : "Cancha"}
                  maxLength={40}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="n-modo">Modo</Label>
                <Select
                  value={compartido ? "compartido" : "exclusivo"}
                  onValueChange={(v) => setCompartido(v === "compartido")}
                >
                  <SelectTrigger id="n-modo" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exclusivo">Exclusivo: una reserva a la vez</SelectItem>
                    <SelectItem value="compartido">Compartido: varias hasta llenar cupos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                La tarifa inicial sale del precio. Al guardar vas a su página para agregar{" "}
                {unidad === "noche" ? "las habitaciones" : "las canchas o salas"} y ajustar
                tarifas{unidad === "hora" ? " y horario" : ""}.
              </p>
            </div>
          )}
        </div>
      )}
    </ItemDialog>
  );
}
