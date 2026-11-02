import "server-only";

import { headers } from "next/headers";

/**
 * Enlace a /registro que se le pasa a quien se invita.
 *
 * Se arma desde el host real para que sirva tanto en local como en produccion
 * sin configurar nada. Lo usan Ajustes › Equipo y /admin.
 */
export async function signupUrlFromHeaders(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/registro`;
}
