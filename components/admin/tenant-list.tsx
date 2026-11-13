"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Store,
  Info,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createTenant } from "@/lib/admin/actions";
import type { TenantSummary } from "@/lib/admin/tenants";
import { formatDate } from "@/lib/format";
import { CurrencySelect, TimezoneInput, slugify } from "./tenant-fields";

export function TenantList({
  tenants,
  signupUrl,
}: {
  tenants: TenantSummary[];
  signupUrl: string;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Negocios"
        description="Alta, datos y suspensión de cada cliente de la plataforma."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            Nuevo negocio
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Todos
            <Badge variant="secondary" className="ml-2 text-2xs">
              {tenants.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {tenants.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Store className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Todavía no hay negocios. Crea el primero.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Negocio</TableHead>
                  <TableHead>Dueño</TableHead>
                  <TableHead className="w-20 text-right">Equipo</TableHead>
                  <TableHead className="w-20">Moneda</TableHead>
                  <TableHead className="w-28">Alta</TableHead>
                  <TableHead className="w-28">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/admin/${t.id}`}
                        className="block min-w-0 hover:underline"
                      >
                        <p className="truncate font-medium">{t.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {t.slug}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <OwnerCell tenant={t} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {t.memberCount}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {t.primaryCurrency}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(t.createdAt.toISOString())}
                    </TableCell>
                    <TableCell>
                      {t.suspendedAt ? (
                        <Badge variant="destructive">Suspendido</Badge>
                      ) : (
                        <Badge variant="secondary">Activo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateTenantDialog
          signupUrl={signupUrl}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function OwnerCell({ tenant }: { tenant: TenantSummary }) {
  if (tenant.owners.length > 0) {
    return (
      <div className="min-w-0">
        {tenant.owners.map((email) => (
          <p key={email} className="truncate">
            {email}
          </p>
        ))}
      </div>
    );
  }
  if (tenant.pendingOwners.length > 0) {
    return (
      <div className="min-w-0">
        {tenant.pendingOwners.map((email) => (
          <p key={email} className="truncate text-muted-foreground">
            {email}{" "}
            <span className="text-2xs text-warning">(sin registrarse)</span>
          </p>
        ))}
      </div>
    );
  }
  // Solo pasa si alguien cancelo la invitacion del dueño antes de que se
  // registrara: el negocio existe pero nadie puede entrar a administrarlo.
  return <span className="text-destructive">Sin dueño</span>;
}

function CreateTenantDialog({
  signupUrl,
  onClose,
}: {
  signupUrl: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Mientras no lo toquen a mano, el slug sigue al nombre.
  const [slugTocado, setSlugTocado] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Caracas");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [creado, setCreado] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (creado) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Negocio creado</DialogTitle>
            <DialogDescription className="text-xs">
              Pásale este enlace a {ownerEmail}. Tiene que registrarse con{" "}
              <strong>ese mismo correo</strong>: al entrar, queda como dueño de{" "}
              {name}. Si ya tenía cuenta, basta con que vuelva a entrar.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-muted/50 p-3">
            <code className="break-all text-xs">{signupUrl}</code>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            Ya tiene sus catálogos por defecto: categorías de ingreso y gasto,
            métodos de pago y categorías de producto y servicio.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button asChild>
              <Link href={`/admin/${creado}`}>Ver el negocio</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const fieldError = (field: string) =>
    error?.field === field ? (
      <p className="text-2xs text-destructive">{error.message}</p>
    ) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Nuevo negocio</DialogTitle>
          <DialogDescription className="text-xs">
            Se crea con sus catálogos por defecto y una invitación de dueño. El
            dueño no necesita tener cuenta todavía.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              value={name}
              autoFocus
              placeholder="Hotel Sol"
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTocado) setSlug(slugify(e.target.value));
              }}
            />
            {fieldError("name")}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="slug">Identificador</Label>
            <Input
              id="slug"
              value={slug}
              spellCheck={false}
              className="font-mono text-sm"
              placeholder="hotel-sol"
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value);
              }}
            />
            {fieldError("slug") ?? (
              <p className="text-2xs text-muted-foreground">
                Para soporte. No se puede cambiar después.
              </p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ownerEmail">Correo del dueño</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={ownerEmail}
              placeholder="dueno@correo.com"
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
            {fieldError("ownerEmail")}
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Zona horaria</Label>
            <TimezoneInput id="timezone" value={timezone} onChange={setTimezone} />
            {fieldError("timezone")}
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Moneda por defecto</Label>
            <CurrencySelect id="currency" value={currency} onChange={setCurrency} />
            {fieldError("primaryCurrency")}
          </div>
        </div>

        {error && !error.field && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            <CircleAlert className="mt-px size-4 shrink-0" />
            {error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !name.trim() || !slug.trim() || !ownerEmail.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await createTenant({
                  name,
                  slug,
                  ownerEmail,
                  timezone,
                  primaryCurrency: currency,
                });
                if (r.ok) {
                  setCreado(r.tenantId);
                  router.refresh();
                } else setError({ message: r.error, field: r.field });
              });
            }}
          >
            {pending ? "Creando…" : "Crear negocio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
