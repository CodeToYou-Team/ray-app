import { describe, it, expect } from "vitest";
import {
  lineSubtotal,
  sumMoney,
  sumQuantity,
  normalizeMoney,
  normalizeQuantity,
  negateQuantity,
  compareMoney,
  isMoney,
  isQuantity,
  isZero,
} from "@/lib/money";

describe("aritmetica de dinero", () => {
  it("normaliza a dos decimales", () => {
    expect(normalizeMoney("12")).toBe("12.00");
    expect(normalizeMoney("12.5")).toBe("12.50");
    expect(normalizeMoney("12.50")).toBe("12.50");
    expect(normalizeMoney("-3.4")).toBe("-3.40");
    expect(normalizeMoney("0")).toBe("0.00");
  });

  it("normaliza cantidades a tres decimales", () => {
    expect(normalizeQuantity("2")).toBe("2.000");
    expect(normalizeQuantity("0.5")).toBe("0.500");
    expect(normalizeQuantity("1.25")).toBe("1.250");
  });

  it("calcula subtotales exactos", () => {
    expect(lineSubtotal("3", "150.00")).toBe("450.00");
    expect(lineSubtotal("1", "0.01")).toBe("0.01");
    expect(lineSubtotal("2.5", "10.00")).toBe("25.00");
    expect(lineSubtotal("0.333", "100.00")).toBe("33.30");
  });

  it("redondea half-up, igual que round() de Postgres", () => {
    // Importa que coincida: el CHECK de la base es
    // `subtotal = round(qty * unit_price, 2)`. Si redondearamos distinto,
    // Postgres rechazaria filas que la app considera correctas.
    expect(lineSubtotal("1.005", "1.00")).toBe("1.01"); // 1.005  -> 1.01
    expect(lineSubtotal("1.5", "0.01")).toBe("0.02"); //    0.015  -> 0.02
    expect(lineSubtotal("2.5", "0.01")).toBe("0.03"); //    0.025  -> 0.03
    expect(lineSubtotal("0.125", "0.04")).toBe("0.01"); //  0.005  -> 0.01
  });

  it("no acumula error de punto flotante", () => {
    // Con numbers de JS: 0.1 + 0.2 = 0.30000000000000004
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");

    // Cien veces 0.07 son exactamente 7.00, no 7.000000000000001
    expect(sumMoney(Array.from({ length: 100 }, () => "0.07"))).toBe("7.00");

    // Un dia de caja de un hotel, centavo a centavo.
    const montos = Array.from({ length: 1000 }, (_, i) =>
      (i % 7 === 0 ? "19.99" : "0.01"),
    );
    const esperado = 143 * 1999 + 857 * 1;
    expect(sumMoney(montos)).toBe(
      `${Math.floor(esperado / 100)}.${String(esperado % 100).padStart(2, "0")}`,
    );
  });

  it("suma cantidades sin perder milesimas", () => {
    expect(sumQuantity(["0.001", "0.002"])).toBe("0.003");
    expect(sumQuantity(Array.from({ length: 1000 }, () => "0.001"))).toBe("1.000");
  });

  it("niega cantidades para la salida de stock", () => {
    expect(negateQuantity("3")).toBe("-3.000");
    expect(negateQuantity("-3.5")).toBe("3.500");
    expect(negateQuantity("0")).toBe("0.000");
  });

  it("compara montos", () => {
    expect(compareMoney("10.00", "9.99")).toBe(1);
    expect(compareMoney("9.99", "10.00")).toBe(-1);
    expect(compareMoney("10.0", "10.00")).toBe(0);
  });

  it("valida formatos", () => {
    expect(isMoney("10.50")).toBe(true);
    expect(isMoney("10")).toBe(true);
    expect(isMoney("-10.50")).toBe(true);
    expect(isMoney("10.505")).toBe(false); // tres decimales
    expect(isMoney("")).toBe(false);
    expect(isMoney("abc")).toBe(false);
    expect(isMoney("1e5")).toBe(false);

    expect(isQuantity("1.250")).toBe(true);
    expect(isQuantity("1.2505")).toBe(false);
  });

  it("detecta el cero", () => {
    expect(isZero("0")).toBe(true);
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0.01")).toBe(false);
  });

  it("rechaza entradas con demasiados decimales en vez de truncarlas en silencio", () => {
    // Truncar sin avisar es como se pierde dinero sin que nadie lo note.
    expect(() => normalizeMoney("10.999")).toThrow(/decimales/);
    expect(() => normalizeQuantity("1.2345")).toThrow(/decimales/);
    expect(() => normalizeMoney("no-es-un-numero")).toThrow(/invalido/);
  });
});
