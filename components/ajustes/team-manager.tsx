"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconUserPlus,
  IconMail,
  IconTrash,
  IconAlertCircle,
  IconInfoCircle,
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
  inviteMember,
  cancelInvitation,
  changeRole,
  removeMember,
} from "@/lib/authz/member-actions";
import { formatDate } from "@/lib/format";
import type { MembershipRole } from "@/lib/db/schema";

export interface TeamMember {
  userId: string;
  email: string;
  fullName: string | null;
  role: MembershipRole;
  joinedAt: Date;
  isSelf: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  createdAt: Date;
}

/** Que puede hacer cada rol, en palabras del negocio. */
const ROLES: { value: MembershipRole; label: string; descripcion: string }[] = [
  {
    value: "owner",
    label: "Dueño",
    descripcion: "Todo, incluidos los reportes de ingresos y la gestión del equipo.",
  },
  {
    value: "manager",
    label: "Encargado",
    descripcion: "Opera el negocio y ve los reportes, pero no administra el equipo.",
  },
  {
    value: "staff",
    label: "Personal",
    descripcion: "Registra operaciones y ve solo las suyas. No ve los totales.",
  },
];

const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

export function TeamManager({
  members,
  invitations,
  signupUrl,
}: {
  members: TeamMember[];
  invitations: TeamInvitation[];
  /** URL de registro que el dueño comparte con quien invita. */
  signupUrl: string;
}) {
  const [inviting, setInviting] = useState(false);

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Equipo</h2>
          <p className="text-sm text-muted-foreground">
            Quién tiene acceso y con qué permisos.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setInviting(true)}>
          <IconUserPlus className="size-3.5" />
          Invitar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Miembros
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {members.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead className="w-40">Rol</TableHead>
                <TableHead className="w-28">Desde</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {m.fullName ?? m.email.split("@")[0]}
                        {m.isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (tú)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleCell member={m} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(m.joinedAt.toISOString())}
                  </TableCell>
                  <TableCell className="text-right">
                    {!m.isSelf && <RemoveButton member={m} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconMail className="size-4 text-muted-foreground" />
              Invitaciones pendientes
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Esperan a que la persona se registre con ese correo exacto.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correo</TableHead>
                  <TableHead className="w-40">Rol</TableHead>
                  <TableHead className="w-28">Invitado</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ROLE_LABEL[inv.role]}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(inv.createdAt.toISOString())}
                    </TableCell>
                    <TableCell className="text-right">
                      <CancelButton id={inv.id} email={inv.email} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {inviting && (
        <InviteDialog signupUrl={signupUrl} onClose={() => setInviting(false)} />
      )}
    </div>
  );
}

function RoleCell({ member }: { member: TeamMember }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (member.isSelf) {
    // Cambiarse el rol a uno mismo deja al cliente sin quien lo administre si
    // era el unico dueño; el servidor lo rechaza y aqui ni se ofrece.
    return (
      <span className="text-sm text-muted-foreground">
        {ROLE_LABEL[member.role]}
      </span>
    );
  }

  return (
    <div>
      <Select
        value={member.role}
        disabled={pending}
        onValueChange={(v) => {
          setError(null);
          start(async () => {
            const r = await changeRole(member.userId, v);
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
      >
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function RemoveButton({ member }: { member: TeamMember }) {
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
        <IconTrash className="size-4" />
        <span className="sr-only">Quitar a {member.email}</span>
      </Button>

      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">Quitar del equipo</DialogTitle>
              <DialogDescription className="text-xs">
                {member.fullName ?? member.email} pierde el acceso. Las
                operaciones que ya registró se quedan: el historial no se toca.
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
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const r = await removeMember(member.userId);
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

function CancelButton({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      disabled={pending}
      title="Cancelar invitación"
      onClick={() =>
        start(async () => {
          await cancelInvitation(id);
          router.refresh();
        })
      }
    >
      <IconTrash className="size-4" />
      <span className="sr-only">Cancelar la invitación de {email}</span>
    </Button>
  );
}

function InviteDialog({
  signupUrl,
  onClose,
}: {
  signupUrl: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("staff");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [pending, start] = useTransition();

  const descripcion = ROLES.find((r) => r.value === role)!.descripcion;

  if (listo) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Invitación creada</DialogTitle>
            <DialogDescription className="text-xs">
              Pásale este enlace a {email}. Tiene que registrarse con{" "}
              <strong>ese mismo correo</strong>: al entrar, el acceso se activa
              solo.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-muted/50 p-3">
            <code className="break-all text-xs">{signupUrl}</code>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <IconInfoCircle className="mt-px size-3.5 shrink-0" />
            Registrarse sin invitación no da acceso a nada, así que el enlace se
            puede compartir sin riesgo.
          </p>

          <DialogFooter>
            <Button onClick={onClose}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Invitar a alguien</DialogTitle>
          <DialogDescription className="text-xs">
            Apunta su correo y su rol. El acceso se activa cuando esa persona se
            registre con ese correo.
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
            <Label htmlFor="role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MembershipRole)}>
              <SelectTrigger id="role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
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
            disabled={pending || !email.trim()}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await inviteMember({ email, role });
                if (r.ok) {
                  setListo(true);
                  router.refresh();
                } else setError(r.error);
              });
            }}
          >
            {pending ? "Invitando…" : "Invitar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
