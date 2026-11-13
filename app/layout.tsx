import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import {
  Instrument_Sans,
  Instrument_Serif,
  Spline_Sans_Mono,
} from "next/font/google";
import "./globals.css";

/**
 * Tres voces, cada una con un trabajo distinto:
 *
 * - `--font-instrument-serif`: el serif solo titula. Existe solo en 400, asi que
 *   un titulo no puede ir en negrita; el peso visual lo da el tamano.
 * - `--font-instrument-sans`: el trabajo diario (tablas, formularios, navegacion).
 * - `--font-spline-mono`: el dinero. Monoespaciado = columnas de cifras que se
 *   leen en vertical, y el 600 existe, que es lo que necesita un total.
 *
 * Los nombres llevan la tipografia y no el rol (`-sans`, `-mono`) a proposito:
 * `@theme` en globals.css es quien traduce rol -> tipografia, y reusar el mismo
 * nombre en los dos lados crea una variable que se referencia a si misma.
 */
const sans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
  weight: "variable",
});

const display = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  display: "swap",
  weight: "400",
});

const mono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
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
