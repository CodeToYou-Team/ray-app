import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // El paquete "server-only" lanza excepcion salvo bajo la condicion de
      // resolucion "react-server", que vitest no usa. Se apunta a un modulo
      // vacio para poder testear los modulos de servidor.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Los tests de RLS comparten tablas: si corren en paralelo se pisan.
    fileParallelism: false,
    /**
     * Los tests de base de datos van contra un Postgres REMOTO (Supabase) por el
     * pooler, asi que cada ida y vuelta cuesta cientos de milisegundos y un test
     * que hace diez queries se pasa comodamente de los 5s por defecto. El limite
     * alto no esconde lentitud del codigo: esconde latencia de red, que es
     * inherente a probar contra la base de verdad.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
