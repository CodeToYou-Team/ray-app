import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import {
  Google_Sans,
  Google_Sans_Code,
  Montserrat,
} from "next/font/google";
import "./globals.css";

/**
 * Tres voces, cada una con un trabajo distinto:
 *
 * - `--font-montserrat`: titula. Es la voz que ya usa el logo (el archivo
 *   original esta compuesto en Montserrat Alternates SemiBold), asi que la
 *   interfaz y la marca hablan igual.
 * - `--font-google-sans`: el trabajo diario (tablas, formularios, navegacion).
 * - `--font-google-sans-code`: el dinero. Monoespaciado = columnas de cifras
 *   que se leen en vertical, y viene de la misma familia que el texto.
 *
 * Montserrat y Google Sans son las dos geometricas, asi que la jerarquia ya no
 * viene de la forma sino del tamano y el peso: el titulo va en 600 y el cuerpo
 * en 400.
 *
 * Los nombres llevan la tipografia y no el rol (`-sans`, `-mono`) a proposito:
 * `@theme` en globals.css es quien traduce rol -> tipografia, y reusar el mismo
 * nombre en los dos lados crea una variable que se referencia a si misma.
 */
const sans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
});

const display = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
});

const mono = Google_Sans_Code({
  variable: "--font-google-sans-code",
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Ray App — Tu negocio bajo control",
  description:
    "Plataforma financiera para pequeñas y medianas empresas. Control total de ingresos, gastos, productos e inventario.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
