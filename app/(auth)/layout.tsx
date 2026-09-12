/**
 * Layout de las pantallas de autenticacion: sin sidebar ni header, porque
 * todavia no hay sesion ni cliente activo que mostrar.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
