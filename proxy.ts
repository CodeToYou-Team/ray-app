import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * En Next 16 este archivo se llama `proxy.ts` (antes `middleware.ts`, ahora
 * deprecado) y exporta `proxy`.
 *
 * SU UNICA RESPONSABILIDAD ES REFRESCAR LA SESION. Aca no va autorizacion.
 *
 * No es una preferencia de estilo: CVE-2025-29927 fue exactamente un bypass de
 * autorizacion hecha en middleware. La autorizacion vive en la capa de datos —
 * `requireCapability()` en lib/authz/session.ts — donde no se puede saltar con
 * un header. Este archivo puede redirigir por comodidad, nunca ser la unica cosa
 * que impida el acceso.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin credenciales configuradas no hay nada que refrescar. Se deja pasar en vez
  // de tumbar la app: asi el proyecto arranca antes de conectar Supabase.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Esta llamada es el punto de todo el archivo: rota el token si esta por
  // vencer y deja la cookie nueva en la respuesta. Los Server Components no
  // pueden escribir cookies, asi que sin esto la sesion caduca a mitad de uso.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /**
     * Todo menos assets estaticos e imagenes. Refrescar la sesion en cada
     * peticion de un .svg es puro costo.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
