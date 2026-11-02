import { describe, it, expect, afterEach, vi } from "vitest";
import { fechaEn, hoyEn, mesDe } from "@/lib/fechas";

/**
 * "Hoy" y "este mes" en la zona del negocio.
 *
 * El caso que motivó esto: Node corre en UTC, y a partir de las 20:00 en
 * Caracas (UTC-4) la fecha UTC ya es la del día siguiente. Una venta de las
 * 21:00 quedaba fechada mañana, y el 31 a esa hora "este mes" ya era el otro.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("hoyEn", () => {
  it("a las 21:00 en Caracas sigue siendo el mismo día, aunque en UTC ya no", () => {
    vi.useFakeTimers();
    // 2026-11-03 01:00 UTC = 2026-11-02 21:00 en Caracas.
    vi.setSystemTime(new Date("2026-11-03T01:00:00Z"));

    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(hoyEn("America/Caracas")).toBe("2026-11-02");
  });

  it("el último día del mes por la noche todavía es ese mes", () => {
    vi.useFakeTimers();
    // 2026-11-01 02:30 UTC = 2026-10-31 22:30 en Caracas.
    vi.setSystemTime(new Date("2026-11-01T02:30:00Z"));

    expect(mesDe(hoyEn("America/Caracas"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("respeta zonas al este de UTC", () => {
    // 2026-11-02 23:30 UTC = 2026-11-03 00:30 en Madrid (UTC+1).
    expect(fechaEn(new Date("2026-11-02T23:30:00Z"), "Europe/Madrid")).toBe("2026-11-03");
  });
});

describe("mesDe", () => {
  it("da el primer y el último día del mes", () => {
    expect(mesDe("2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(mesDe("2028-02-14")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("el mes anterior cruza el año sin problema", () => {
    expect(mesDe("2026-01-31", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("desde el 31 el mes anterior no se desborda", () => {
    // Con Date "de calendario" mal usado, el 31 de marzo menos un mes cae en
    // marzo (31 de febrero = 3 de marzo).
    expect(mesDe("2026-03-31", -1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("varios meses atrás, para los periodos de Reportes", () => {
    expect(mesDe("2026-11-02", -5).from).toBe("2026-06-01");
  });
});
