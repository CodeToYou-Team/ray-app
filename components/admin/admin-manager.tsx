"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  History,
  Trash2,
  UserPlus,
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
import { changeAdminLevel, grantAdmin, revokeAdmin } from "@/lib/admin/actions";
import type { AdminHistoryEntry, PlatformAdmin } from "@/lib/admin/admins";
import type { PlatformAdminLevel } from "@/lib/db/schema";
import { formatDate } from "@/lib/format";

const LEVELS: { value: PlatformAdminLevel; label: string; descripcion: string }[] = [
  {
    value: "admin",
    label: "Admin",
    descripcion: "Crea, edita y suspende negocios, y gestiona sus equipos.",
  },
  {
    value: "superadmin",
    label: "Superadmin",
    descripcion: "Todo lo anterior, y además nombra, cambia y quita administradores.",
  },
];

const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label]));

export function AdminManager({
  admins,
  history,
}: {
  admins: PlatformAdmin[];
  history: AdminHistoryEntry[];
}) {
  const [granting, setGranting] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Administradores"
        description="Quién gestiona la plataforma. Siempre queda al menos un superadmin."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setGranting(true)}>
            <UserPlus className="size-3.5" />
            Nombrar
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Administradores
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {admins.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead className="w-40">Nivel</TableHead>
                <TableHead className="w-28">Desde</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.userId}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {a.fullName ?? a.email.split("@")[0]}
                        {a.isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (tú)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <LevelCell admin={a} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(a.createdAt.toISOString())}
                  </TableCell>
                  <TableCell className="text-right">
                    {!a.isSelf && <RevokeButton admin={a} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4 text-muted-foreground" />
            Historial
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Lo registra la base de datos, también lo que se hace por script.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Todavía no hay cambios registrados.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <HistoryText entry={h} />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {h.actorEmail ?? "script"} · {formatDate(h.at.toISOString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {granting && <GrantDialog onClose={() => setGranting(false)} />}
    </div>
  );
}

function levelName(value: unknown): string {
  return typeof value === "string" ? (LEVEL_LABEL[value] ?? value) : "—";
}

function HistoryText({ entry }: { entry: AdminHistoryEntry }) {
  const quien = <strong className="font-medium">{entry.email ?? "cuenta borrada"}</strong>;
  const level = entry.diff.level;

  if (entry.action === "create") {
    return <>Se nombró a {quien} como {levelName(level).toLowerCase()}</>;
  }
  if (entry.action === "delete") {
    return <>Se quitó a {quien} ({levelName(level).toLowerCase()})</>;
  }
  const cambio = level as { from?: unknown; to?: unknown } | undefined;
  return (
    <>
      {quien} pasó de {levelName(cambio?.from).toLowerCase()} a{" "}
      {levelName(cambio?.to).toLowerCase()}
    </>
  );
}

function LevelCell({ admin }: { admin: PlatformAdmin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (admin.isSelf) {
    // Bajarse a uno mismo por error es la forma mas corta de quedarse sin quien
    // gestione admins; el servidor lo rechaza y aqui ni se ofrece.
    return <span className="text-sm text-muted-foreground">{LEVEL_LABEL[admin.level]}</span>;
  }

  return (
    <div>
      <Select
        value={admin.level}
        disabled={pending}
        onValueChange={(v) => {
          setError(null);
          start(async () => {
            const r = await changeAdminLevel(admin.userId, v);
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEVELS.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function RevokeButton({ admin }: { admin: PlatformAdmin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        disabled={pending}
        onClick={() => setConfirmando(true)}
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Quitar a {admin.email}</span>
      </Button>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">Quitar administrador</DialogTitle>
              <DialogDescription className="text-xs">
                {admin.fullName ?? admin.email} deja de entrar a /admin. Su cuenta
                y su acceso a un negocio, si tiene, no cambian.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                <CircleAlert className="mt-px size-4 shrink-0" />
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
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const r = await revokeAdmin(admin.userId);
                    if (r.ok) {
                      setConfirmando(false);
                      router.refresh();
                    } else setError(r.error);
                  });
                }}
              >
                {pending ? "Quitando…" : "Quitar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function GrantDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [level, setLevel] = useState<PlatformAdminLevel>("admin");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const descripcion = LEVELS.find((l) => l.value === level)!.descripcion;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Nombrar administrador</DialogTitle>
          <DialogDescription className="text-xs">
            La persona tiene que tener cuenta ya. El acceso a /admin se activa al
            instante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              value={email}
              autoFocus
              placeholder="persona@correo.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="level">Nivel</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as PlatformAdminLevel)}>
              <SelectTrigger id="level" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{descripcion}</p>
          </div>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-px size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !email.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await grantAdmin({ email, level });
                if (r.ok) {
                  onClose();
                  router.refresh();
                } else setError(r.error);
              });
            }}
          >
            {pending ? "Nombrando…" : "Nombrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
