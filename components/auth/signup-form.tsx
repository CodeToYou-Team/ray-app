"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { IconAlertCircle, IconMailCheck } from "@tabler/icons-react";
import { signUp, type SignupState } from "@/lib/authz/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignupState = { error: null, confirmar: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creando cuenta…" : "Crear cuenta"}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signUp, initialState);

  if (state.confirmar) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
            <IconMailCheck className="size-5" />
          </div>
          <div>
            <p className="font-medium">Revisa tu correo</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Te enviamos un enlace para confirmar la cuenta. Después de
              confirmarlo, entra normalmente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nombre</Label>
            <Input
              id="fullName"
              name="fullName"
              autoComplete="name"
              placeholder="Tu nombre"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="tu@correo.com"
              required
            />
            <p className="text-xs text-muted-foreground">
              Tiene que ser exactamente el correo con el que te invitaron.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
          </div>

          {state.error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <IconAlertCircle className="mt-px size-4 shrink-0" />
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
