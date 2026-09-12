"use client";

import { useState, useTransition } from "react";
import {
  IconPlus,
  IconPencil,
  IconArchive,
  IconArchiveOff,
  IconAlertCircle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createCatalogItem,
  updateCatalogItem,
  setCatalogItemArchived,
} from "@/lib/catalogs/actions";
import { CATALOGS, type CatalogKey } from "@/lib/catalogs/keys";
import {
  PRIMARY_CURRENCIES,
  STABLECOINS,
  OTHER_CURRENCIES,
  findCurrency,
} from "@/lib/currencies";

export interface CatalogRow {
  id: string;
  code: string;
  label: string;
  currency: string | null;
  archivedAt: Date | null;
}

interface Props {
  catalogs: { key: CatalogKey; items: CatalogRow[] }[];
  /** Los de solo lectura ven la tabla pero no los botones. */
  canManage: boolean;
}

type Editing =
  | { mode: "create"; catalogKey: CatalogKey }
  | { mode: "edit"; catalogKey: CatalogKey; item: CatalogRow };

export function CatalogManager({ catalogs, canManage }: Props) {
  const [tab, setTab] = useState<CatalogKey>(catalogs[0]?.key ?? "income_category");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as CatalogKey)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="h-auto flex-wrap justify-start">
            {catalogs.map(({ key }) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {CATALOGS[key].label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              id="mostrar-archivados"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="mostrar-archivados" className="text-xs font-normal">
              Ver archivados
            </Label>
          </div>
        </div>

        {catalogs.map(({ key, items }) => {
          const visible = showArchived
            ? items
            : items.filter((i) => !i.archivedAt);

          return (
            <TabsContent key={key} value={key} className="mt-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {CATALOGS[key].description}
                </p>
                {canManage && (
                  <Button
                    size="sm"
                    onClick={() => setEditing({ mode: "create", catalogKey: key })}
                  >
                    <IconPlus className="size-4" />
                    Nuevo
                  </Button>
                )}
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        {CATALOGS[key].hasCurrency && (
                          <TableHead className="w-24">Moneda</TableHead>
                        )}
                        <TableHead className="w-48">Identificador</TableHead>
                        {canManage && (
                          <TableHead className="w-24 text-right">Acciones</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="py-8 text-center text-sm text-muted-foreground"
                          >
                            No hay elementos todavía.
                          </TableCell>
                        </TableRow>
                      )}

                      {visible.map((item) => (
                        <TableRow
                          key={item.id}
                          className={item.archivedAt ? "opacity-55" : undefined}
                        >
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-2">
                              {item.label}
                              {item.archivedAt && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Archivado
                                </Badge>
                              )}
                            </span>
                          </TableCell>

                          {CATALOGS[key].hasCurrency && (
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="font-mono text-[10px]"
                                title={findCurrency(item.currency ?? "")?.name}
                              >
                                {item.currency}
                              </Badge>
                            </TableCell>
                          )}

                          <TableCell>
                            <code className="text-xs text-muted-foreground">
                              {item.code}
                            </code>
                          </TableCell>

                          {canManage && (
                            <TableCell className="text-right">
                              <ItemActions
                                item={item}
                                onEdit={() =>
                                  setEditing({ mode: "edit", catalogKey: key, item })
                                }
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>

      {editing && (
        <ItemDialog
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ItemActions({
  item,
  onEdit,
}: {
  item: CatalogRow;
  onEdit: () => void;
}) {
  const [pending, start] = useTransition();
  const archived = Boolean(item.archivedAt);

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
        <IconPencil className="size-4" />
        <span className="sr-only">Editar {item.label}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setCatalogItemArchived({ id: item.id, archived: !archived });
          })
        }
      >
        {archived ? (
          <IconArchiveOff className="size-4" />
        ) : (
          <IconArchive className="size-4" />
        )}
        <span className="sr-only">
          {archived ? "Restaurar" : "Archivar"} {item.label}
        </span>
      </Button>
    </div>
  );
}

function ItemDialog({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  const def = CATALOGS[editing.catalogKey];
  const existing = editing.mode === "edit" ? editing.item : null;

  const [label, setLabel] = useState(existing?.label ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "USD");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = existing
        ? await updateCatalogItem({
            id: existing.id,
            catalogKey: editing.catalogKey,
            label,
            currency: def.hasCurrency ? currency : null,
          })
        : await createCatalogItem({
            catalogKey: editing.catalogKey,
            label,
            currency: def.hasCurrency ? currency : null,
          });

      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {existing ? `Editar ${def.singular.toLowerCase()}` : `Nuevo: ${def.singular.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {existing
              ? "Puedes cambiar el nombre. El identificador no cambia nunca, para que los registros anteriores sigan apuntando aquí."
              : def.description}
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
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={def.singular}
            />
          </div>

          {def.hasCurrency && (
            <div className="space-y-2">
              <Label htmlFor="currency">Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue placeholder="Elige una moneda" />
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
                  {/* Una moneda historica que ya no este en la lista se sigue
                      ofreciendo, o al editar ese metodo se perderia su valor. */}
                  {currency && !findCurrency(currency) && (
                    <SelectGroup>
                      <SelectLabel>Actual</SelectLabel>
                      <SelectItem value={currency}>
                        <span className="font-mono text-xs">{currency}</span>
                      </SelectItem>
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Los pagos con este método se registran en esta moneda. Los totales
                se llevan separados por moneda; no se convierte nada.
              </p>
            </div>
          )}

          {existing && (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Identificador
              </p>
              <code className="text-xs">{existing.code}</code>
            </div>
          )}

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
