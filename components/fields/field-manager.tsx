"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconPlus,
  IconPencil,
  IconArchive,
  IconArchiveOff,
  IconAlertCircle,
  IconTrash,
  IconEye,
  IconEyeOff,
  IconLock,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  createField,
  updateField,
  updateFixedField,
  setFieldArchived,
} from "@/lib/fields/actions";
import { FIELD_TYPES, FIELD_TYPE_KEYS } from "@/lib/fields/types";
import type { ResolvedField } from "@/lib/fields/resolve";
import type { FieldEntity, FieldType } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface Props {
  /** Incluye archivadas y ocultas: esta es la pantalla que las administra. */
  productFields: (ResolvedField & { id?: string })[];
  serviceFields: (ResolvedField & { id?: string })[];
  bookingFields: (ResolvedField & { id?: string })[];
  catalogKeys: { key: string; label: string }[];
}

type Editing =
  | { mode: "create"; entity: FieldEntity }
  | { mode: "edit"; entity: FieldEntity; field: ResolvedField & { id?: string } };

export function FieldManager({
  productFields,
  serviceFields,
  bookingFields,
  catalogKeys,
}: Props) {
  const [tab, setTab] = useState<FieldEntity>("product");
  const [editing, setEditing] = useState<Editing | null>(null);

  const listas: Record<FieldEntity, (ResolvedField & { id?: string })[]> = {
    product: productFields,
    service: serviceFields,
    booking: bookingFields,
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Columnas</h2>
          <p className="text-sm text-muted-foreground">
            Qué información guardas de cada producto, servicio y reserva. Las
            del sistema se pueden renombrar y ocultar; las que crees tú, además
            archivar.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setEditing({ mode: "create", entity: tab })}
        >
          <IconPlus className="size-3.5" />
          Nueva columna
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FieldEntity)}>
        <TabsList>
          <TabsTrigger value="product" className="text-xs">
            Productos
          </TabsTrigger>
          <TabsTrigger value="service" className="text-xs">
            Servicios
          </TabsTrigger>
          <TabsTrigger value="booking" className="text-xs">
            Reservas
          </TabsTrigger>
        </TabsList>

        {(["product", "service", "booking"] as FieldEntity[]).map((entity) => (
          <TabsContent key={entity} value={entity} className="mt-4 space-y-3">
            {entity === "booking" && (
              <p className="text-xs text-muted-foreground">
                Nombre, documento, teléfono y notas siempre están en la reserva.
                Aquí agregas lo que tu negocio necesita además: la placa del
                vehículo, el motivo del viaje, cómo se enteró de ti. Valen para
                todas las reservas, de cualquier servicio.
              </p>
            )}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Columna</TableHead>
                      <TableHead className="w-36">Tipo</TableHead>
                      <TableHead className="w-40">Identificador</TableHead>
                      <TableHead className="w-24 text-center">En tabla</TableHead>
                      <TableHead className="w-24 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listas[entity].length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Todavía no hay columnas. Crea una con “Nueva columna”.
                        </TableCell>
                      </TableRow>
                    )}
                    {listas[entity].map((f) => (
                      <TableRow
                        key={f.key}
                        className={cn(
                          f.archived && "opacity-55",
                          f.hidden && "opacity-70",
                        )}
                      >
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {f.label}
                            {f.required && (
                              <span className="text-destructive" title="Obligatorio">
                                *
                              </span>
                            )}
                            {f.source === "fixed" && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[9px] font-normal"
                                title="Columna del sistema: su tipo no se puede cambiar"
                              >
                                <IconLock className="size-2.5" />
                                sistema
                              </Badge>
                            )}
                            {f.archived && (
                              <Badge variant="secondary" className="text-[9px]">
                                archivada
                              </Badge>
                            )}
                            {f.hidden && !f.archived && (
                              <Badge variant="secondary" className="text-[9px]">
                                oculta
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {FIELD_TYPES[f.type].label}
                        </TableCell>
                        <TableCell>
                          <code className="text-xs text-muted-foreground">
                            {f.key}
                          </code>
                        </TableCell>
                        <TableCell className="text-center">
                          {f.showInTable ? (
                            <IconEye className="mx-auto size-4 text-muted-foreground" />
                          ) : (
                            <IconEyeOff className="mx-auto size-4 text-muted-foreground/40" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() =>
                                setEditing({ mode: "edit", entity, field: f })
                              }
                            >
                              <IconPencil className="size-4" />
                              <span className="sr-only">Editar {f.label}</span>
                            </Button>
                            {f.editable.archive && f.id && (
                              <ArchiveButton id={f.id} archived={f.archived} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {editing && (
        <FieldDialog
          editing={editing}
          catalogKeys={catalogKeys}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
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
          await setFieldArchived(id, !archived);
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

interface OptionDraft {
  code?: string;
  label: string;
  archivedAt?: string;
}

function FieldDialog({
  editing,
  catalogKeys,
  onClose,
}: {
  editing: Editing;
  catalogKeys: { key: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const existente = editing.mode === "edit" ? editing.field : null;
  const esFija = existente?.source === "fixed";

  const [label, setLabel] = useState(existente?.label ?? "");
  const [type, setType] = useState<FieldType>(existente?.type ?? "text");
  const [required, setRequired] = useState(existente?.required ?? false);
  const [showInTable, setShowInTable] = useState(existente?.showInTable ?? true);
  const [hidden, setHidden] = useState(existente?.hidden ?? false);
  const [catalogKey, setCatalogKey] = useState(
    typeof existente?.config?.catalogKey === "string"
      ? existente.config.catalogKey
      : (catalogKeys[0]?.key ?? ""),
  );
  const [options, setOptions] = useState<OptionDraft[]>(
    existente?.options.filter((o) => !o.archivedAt) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const def = FIELD_TYPES[type];
  const archivadas = existente?.options.filter((o) => o.archivedAt) ?? [];

  function submit() {
    setError(null);
    start(async () => {
      const result = existente
        ? esFija
          ? await updateFixedField(editing.entity, existente.key, {
              label,
              hidden,
              showInTable,
            })
          : await updateField(existente.id!, {
              label,
              required,
              options: options.filter((o) => o.label.trim()),
              config: def.usesCatalog ? { catalogKey } : {},
              hidden,
              showInTable,
            })
        : await createField({
            entity: editing.entity,
            label,
            type,
            required,
            options: def.usesOptions
              ? options.filter((o) => o.label.trim())
              : undefined,
            config: def.usesCatalog ? { catalogKey } : {},
            showInTable,
          });

      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {existente ? `Editar "${existente.label}"` : "Nueva columna"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {esFija
              ? "Es una columna del sistema: puedes renombrarla y decidir dónde aparece, pero su tipo y su obligatoriedad son fijos porque de ellos depende el inventario."
              : existente
                ? "El identificador y el tipo no cambian nunca: son lo que tienen guardado los registros. Para cambiar el tipo, crea una columna nueva y archiva esta."
                : "El identificador se genera del nombre y queda fijo para siempre. Renombrar después cambia solo lo que se ve."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="label">Nombre</Label>
            <Input
              id="label"
              value={label}
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {!existente && (
            <div className="space-y-2">
              <Label htmlFor="type">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as FieldType)}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {FIELD_TYPES[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{def.hint}</p>
            </div>
          )}

          {existente && (
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 px-3 py-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Identificador
                </p>
                <code className="text-xs">{existente.key}</code>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Tipo
                </p>
                <span className="text-xs">{FIELD_TYPES[existente.type].label}</span>
              </div>
            </div>
          )}

          {def.usesCatalog && !esFija && (
            <div className="space-y-2">
              <Label htmlFor="catalogKey">Catálogo</Label>
              <Select value={catalogKey} onValueChange={setCatalogKey}>
                <SelectTrigger id="catalogKey" className="w-full">
                  <SelectValue placeholder="Elige un catálogo" />
                </SelectTrigger>
                <SelectContent>
                  {catalogKeys.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Las opciones se administran en Catálogos. Úsalo cuando la opción
                tenga datos propios.
              </p>
            </div>
          )}

          {def.usesOptions && !esFija && (
            <OptionsEditor
              options={options}
              setOptions={setOptions}
              archivadas={archivadas}
            />
          )}

          <div className="space-y-3 border-t pt-4">
            {!esFija && (
              <div className="flex items-center justify-between">
                <Label htmlFor="required" className="text-sm font-normal">
                  Obligatorio al guardar
                </Label>
                <Switch
                  id="required"
                  checked={required}
                  onCheckedChange={setRequired}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label htmlFor="showInTable" className="text-sm font-normal">
                Mostrar como columna en el listado
              </Label>
              <Switch
                id="showInTable"
                checked={showInTable}
                onCheckedChange={setShowInTable}
              />
            </div>

            {existente && !existente.alwaysVisible && (
              <div className="flex items-center justify-between">
                <Label htmlFor="hidden" className="text-sm font-normal">
                  Ocultar del formulario
                </Label>
                <Switch id="hidden" checked={hidden} onCheckedChange={setHidden} />
              </div>
            )}
            {existente?.alwaysVisible && (
              <p className="text-xs text-muted-foreground">
                Esta columna no se puede ocultar: sin ella no se podría
                identificar la fila.
              </p>
            )}
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
          <Button onClick={submit} disabled={pending || !label.trim()}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditor({
  options,
  setOptions,
  archivadas,
}: {
  options: OptionDraft[];
  setOptions: (o: OptionDraft[]) => void;
  archivadas: { code: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Opciones</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOptions([...options, { label: "" }])}
        >
          <IconPlus className="size-3.5" />
          Agregar
        </Button>
      </div>

      {options.map((o, i) => (
        <div key={o.code ?? `nueva-${i}`} className="flex items-center gap-2">
          <Input
            value={o.label}
            placeholder="Nombre de la opción"
            onChange={(e) =>
              setOptions(
                options.map((x, j) =>
                  j === i ? { ...x, label: e.target.value } : x,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => setOptions(options.filter((_, j) => j !== i))}
          >
            <IconTrash className="size-4" />
            <span className="sr-only">Quitar opción</span>
          </Button>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Quitar una opción no la borra: se archiva. Los registros que ya la
        tenían la siguen mostrando, pero deja de ofrecerse al crear.
      </p>

      {archivadas.length > 0 && (
        <div className="rounded-md bg-muted/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Archivadas
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {archivadas.map((o) => o.label).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
