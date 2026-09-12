import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Solo la parte de autenticacion del cliente de Supabase.
 *
 * El tipo de retorno se estrecha a `{ auth }` a proposito: asi `.from()`,
 * `.rpc()` y `.storage` no son ni alcanzables, y la regla "supabase-js nunca
 * lee datos" pasa de ser un comentario a un error de compilacion.
 *
 * Los datos van por Drizzle (lib/db) con withTenant y RLS, sobre el protocolo
 * nativo de Postgres. Por eso la Data API (PostgREST) del proyecto esta
 * desactivada: no la usamos, y encendida solo seria superficie de ataque.
 */
export type SupabaseAuth = SupabaseClient["auth"];

export async function createSupabaseServerClient(): Promise<{
  auth: SupabaseAuth;
}> {
  const cookieStore = await cookies();
  const env = publicEnv();

  const client = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Los Server Components no pueden escribir cookies. Cuando pasa,
            // el refresh de token lo hace proxy.ts en la siguiente navegacion.
          }
        },
      },
    },
  );

  return { auth: client.auth };
}
