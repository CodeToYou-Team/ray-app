"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconCalendarEvent,
  IconPencil,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  etiqueta,
  ItemDialog,
  type CategoryOption,
  type ServiceRow,
} from "@/components/productos/catalog-view";
import { formatFieldValue } from "@/components/fields/field-input";
import { setServiceArchived } from "@/lib/productos/actions";
import { customFields, type ResolvedField } from "@/lib/fields/resolve";
import type { ServiceSetupRow } from "@/lib/reservas/queries";
import { formatMoney } from "@/lib/format";
import { Dato, EdicionProvider, ErrorBox, Seccion, useEdicion } from "./seccion";
import { SeccionReserva } from "./seccion-reserva";
import { SeccionTarifas } from "./seccion-tarifas";
import { SeccionRecursos } from "./seccion-recursos";
import { SeccionHorario } from "./seccion-horario";

/**
 * Un servicio en su página: lo que se vende y, si se reserva, cómo, a qué
 * tarifas, con qué recursos y en qué horario. Antes esto vivía en dos
 * pantallas (Servicios y Recursos) sin nada que llevara de una a la otra.
 *
 * Va en pestañas (ver `PestanasServicio`) en vez de una columna larga. Cada
 * sección se lee como dato y se edita por separado; solo una a la vez (ver
 * `EdicionProvider`).
 */
export function ServiceDetail({
  servicio,
  setup,
  categories,
  fields,
  defaultCurrency,
  canManage,
  canSetup,
  tabInicial,
}: {
  servicio: ServiceRow;
  /** Ausente si el servicio está archivado. */
  setup: ServiceSetupRow | null;
  categories: CategoryOption[];
  fields: ResolvedField[];
  defaultCurrency: string;
  /** product:manage: datos y archivar. */
  canManage: boolean;
  /** resource:manage: cómo se reserva, tarifas, recursos y horario. */
  canSetup: boolean;
  /** La pestaña que abre, de `?tab=`. Si no existe, "general". */
  tabInicial?: string;
}) {
  const [editandoDatos, setEditandoDatos] = useState(false);
  const personalizados = customFields(fields);
  const unidad = setup?.unidad ?? null;

  return (
    <EdicionProvider>
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="space-y-3">
          <Link
            href="/servicios"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <IconArrowLeft className="size-3.5" />
            Servicios
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                {servicio.name}
                {servicio.archived && <Badge variant="secondary">Archivado</Badge>}
                {!servicio.archived && !servicio.isActive && (
                  <Badge variant="outline">No disponible para vender</Badge>
                )}
              </h2>
              <p className="text-sm text-muted-foreground">
                {servicio.categoryLabel}
                {unidad && setup && (
                  <>
                    {" · "}
                    {setup.resources.length === 0
                      ? "sin recursos todavía"
                      : `${setup.resources.length} ${setup.resources.length === 1 ? "recurso" : "recursos"}`}
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {unidad && setup && setup.resources.length > 0 && !servicio.archived && (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <Link href="/reservas">
                    <IconCalendarEvent className="size-4" />
                    Ver disponibilidad
                  </Link>
                </Button>
              )}
              {canManage && <BotonArchivar servicio={servicio} />}
            </div>
          </div>
        </div>

        <PestanasServicio
          tabInicial={tabInicial}
          setup={setup}
          canSetup={canSetup}
          general={
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {/* Reservable pero apagado: explica por qué no aparece en Disponibilidad. */}
              {unidad && !servicio.isActive && !servicio.archived && (
                <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground lg:col-span-2">
                  Está marcado como no disponible para vender: no acepta reservas nuevas. Las que
                  ya tiene siguen su curso. Actívalo en Datos.
                </p>
              )}

              <Seccion
                titulo="Datos"
                descripcion="Lo que se usa para venderlo en Finanzas."
                accion={
                  canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setEditandoDatos(true)}
                    >
                      <IconPencil className="size-3.5" />
                      Editar
                    </Button>
                  )
                }
              >
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Dato etiqueta={etiqueta(fields, "category_id", "Categoría")}>
                    {servicio.categoryLabel}
                  </Dato>
                  <Dato etiqueta={etiqueta(fields, "price", "Precio")}>
                    <span className="font-mono">{formatMoney(servicio.price, servicio.currency)}</span>
                  </Dato>
                  <Dato etiqueta="Disponible para vender">{servicio.isActive ? "Sí" : "No"}</Dato>
                  {personalizados.map((f) => (
                    <Dato key={f.key} etiqueta={f.label}>
                      {formatFieldValue(f, servicio.custom?.[f.key]) || "—"}
                    </Dato>
                  ))}
                </dl>
              </Seccion>

              {setup && <SeccionReserva servicio={setup} puedeEditar={canSetup} />}
            </div>
          }
        />

        {editandoDatos && (
          <ItemDialog
            editing={{ tab: "servicios", row: servicio }}
            categories={categories}
            fields={fields}
            defaultCurrency={defaultCurrency}
            onClose={() => setEditandoDatos(false)}
          />
        )}
      </div>
    </EdicionProvider>
  );
}

type Pestana = "general" | "tarifas" | "recursos" | "horario";

/**
 * Las pestañas de la página: General (datos y cómo se reserva), Tarifas,
 * Recursos y, por horas, Horario. Un servicio que no se reserva solo tiene
 * General, y se muestra sin barra de pestañas.
 *
 * La pestaña queda en la URL (`?tab=recursos`) para que recargar no la pierda
 * y para poder enlazar directo ("Agrégalos" en la cuadrícula). Cambiar de
 * pestaña cierra lo que se estuviera editando.
 */
function PestanasServicio({
  tabInicial,
  setup,
  canSetup,
  general,
}: {
  tabInicial?: string;
  setup: ServiceSetupRow | null;
  canSetup: boolean;
  general: ReactNode;
}) {
  const { cerrar } = useEdicion();
  const unidad = setup?.unidad ?? null;

  const disponibles: Pestana[] = !unidad
    ? ["general"]
    : unidad === "hora"
      ? ["general", "tarifas", "recursos", "horario"]
      : ["general", "tarifas", "recursos"];
  const [tab, setTab] = useState<Pestana>(
    disponibles.includes(tabInicial as Pestana) ? (tabInicial as Pestana) : "general",
  );
  // Dejar de reservar con la pestaña Horario abierta: vuelve a General.
  const actual = disponibles.includes(tab) ? tab : "general";

  if (!setup || !unidad) return <>{general}</>;

  function cambiar(v: string) {
    cerrar();
    setTab(v as Pestana);
    const url = new URL(window.location.href);
    if (v === "general") url.searchParams.delete("tab");
    else url.searchParams.set("tab", v);
    window.history.replaceState(null, "", url);
  }

  const sinRecursos = setup.resources.length === 0;

  return (
    <Tabs value={actual} onValueChange={cambiar} className="gap-4">
      <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
        <TabsTrigger value="general" className="flex-none px-3">
          General
        </TabsTrigger>
        <TabsTrigger value="tarifas" className="flex-none px-3">
          Tarifas
          <Contador n={setup.tarifas.length} />
        </TabsTrigger>
        <TabsTrigger value="recursos" className="flex-none px-3">
          Recursos
          {sinRecursos ? (
            <span
              aria-label="Sin recursos: todavía no se puede reservar"
              className="size-1.5 rounded-full bg-warning"
            />
          ) : (
            <Contador n={setup.resources.length} />
          )}
        </TabsTrigger>
        {unidad === "hora" && (
          <TabsTrigger value="horario" className="flex-none px-3">
            Horario
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="general">{general}</TabsContent>
      <TabsContent value="tarifas">
        <SeccionTarifas
          serviceId={setup.id}
          grano={unidad}
          tarifas={setup.tarifas}
          monedaServicio={setup.currency}
          perPerson={setup.perPerson}
          puedeEditar={canSetup}
        />
      </TabsContent>
      <TabsContent value="recursos">
        <SeccionRecursos
          serviceId={setup.id}
          unidad={unidad}
          shared={setup.shared}
          resourceLabel={setup.resourceLabel}
          recursos={setup.resources}
          puedeEditar={canSetup}
        />
      </TabsContent>
      {unidad === "hora" && (
        <TabsContent value="horario">
          <SeccionHorario
            serviceId={setup.id}
            modo={setup.horario}
            turnos={setup.turnos}
            puedeEditar={canSetup}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

function Contador({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
      {n}
    </span>
  );
}

/**
 * Archivar o restaurar el servicio entero. El servidor se niega si tiene
 * reservas pendientes, y el motivo se muestra.
 */
function BotonArchivar({ servicio }: { servicio: ServiceRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await setServiceArchived(servicio.id, !servicio.archived);
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
      >
        {servicio.archived ? (
          <>
            <IconArchiveOff className="size-4" />
            Restaurar
          </>
        ) : (
          <>
            <IconArchive className="size-4" />
            Archivar
          </>
        )}
      </Button>
      {error && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md bg-popover shadow-md">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
    </div>
  );
}
