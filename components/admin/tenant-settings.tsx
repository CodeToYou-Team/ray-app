"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconCheck,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
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
import { setTenantSuspended, updateTenant } from "@/lib/admin/actions";
import type { TenantSummary } from "@/lib/admin/tenants";
import { formatDate } from "@/lib/format";
import { CurrencySelect, TimezoneInput } from "./tenant-fields";

export function TenantSettings({ tenant }: { tenant: TenantSummary }) {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [currency, setCurrency] = useState(tenant.primaryCurrency);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [pending, start] = useTransition();

  const cambio =
    name !== tenant.name ||
    timezone !== tenant.timezone ||
    currency !== tenant.primaryCurrency;

  const fieldError = (field: string) =>
    error?.field === field ? (
      <p className="text-[11px] text-destructive">{error.message}</p>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <span className="truncate">{tenant.name}</span>
            {tenant.suspendedAt && <Badge variant="destructive">Suspendido</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{tenant.slug}</span> · alta el{" "}
            {formatDate(tenant.createdAt.toISOString())}
            {tenant.suspendedAt &&
              ` · suspendido el ${formatDate(tenant.suspendedAt.toISOString())}`}
          </p>
        </div>
        <SuspendButton tenant={tenant} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Datos del negocio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              {fieldError("name")}
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

          {timezone !== tenant.timezone && (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning">
              <IconAlertCircle className="mt-px size-3.5 shrink-0" />
              Cambiar la zona horaria cambia cómo se leen las horas ya
              registradas: reservas, horas pico y cortes por día. Hazlo solo
              para corregir una zona mal puesta.
            </p>
          )}

          {error && !error.field && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <IconAlertCircle className="mt-px size-4 shrink-0" />
              {error.message}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!cambio || pending}
              onClick={() => {
                setError(null);
                setGuardado(false);
                start(async () => {
                  const r = await updateTenant(tenant.id, {
                    name,
                    timezone,
                    primaryCurrency: currency,
                  });
                  if (r.ok) {
                    setGuardado(true);
                    router.refresh();
                  } else setError({ message: r.error, field: r.field });
                });
              }}
            >
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            {guardado && !cambio && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <IconCheck className="size-3.5" />
                Guardado
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SuspendButton({ tenant }: { tenant: TenantSummary }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const suspendido = tenant.suspendedAt !== null;

  function aplicar() {
    setError(null);
    start(async () => {
      const r = await setTenantSuspended(tenant.id, !suspendido);
      if (r.ok) {
        setConfirmando(false);
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={suspendido ? "default" : "outline"}
        className="gap-1.5"
        onClick={() => setConfirmando(true)}
      >
        {suspendido ? (
          <IconPlayerPlay className="size-3.5" />
        ) : (
          <IconPlayerPause className="size-3.5" />
        )}
        {suspendido ? "Reactivar" : "Suspender"}
      </Button>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">
                {suspendido ? `Reactivar ${tenant.name}` : `Suspender ${tenant.name}`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {suspendido
                  ? "Su equipo vuelve a entrar y encuentra todo como lo dejó."
                  : "Nadie de su equipo podrá entrar ni registrar nada, tampoco quien ya tenga la app abierta. No se borra ningún dato y se puede reactivar cuando quieras."}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                <IconAlertCircle className="mt-px size-4 shrink-0" />
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setConfirmando(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant={suspendido ? "default" : "destructive"}
                disabled={pending}
                onClick={aplicar}
              >
                {pending
                  ? suspendido
                    ? "Reactivando…"
                    : "Suspendiendo…"
                  : suspendido
                    ? "Reactivar"
                    : "Suspender"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
