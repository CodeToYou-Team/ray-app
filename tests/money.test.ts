import { describe, it, expect } from "vitest";
import {
  convertMoney,
  isRate,
  normalizeRate,
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

describe("tasa de cambio", () => {
  it("valida tasas", () => {
    expect(isRate("40")).toBe(true);
    expect(isRate("36.712345")).toBe(true);
    expect(isRate("0.002577")).toBe(true);
    // Cero o negativa no es una tasa: daria un monto cero o negativo.
    expect(isRate("0")).toBe(false);
    expect(isRate("0.000000")).toBe(false);
    expect(isRate("-40")).toBe(false);
    expect(isRate("")).toBe(false);
    expect(isRate("abc")).toBe(false);
    expect(isRate("1.2345678")).toBe(false); // siete decimales
  });

  it("normaliza a seis decimales", () => {
    expect(normalizeRate("40")).toBe("40.000000");
    expect(normalizeRate("36.71")).toBe("36.710000");
  });

  it("convierte exacto", () => {
    expect(convertMoney("150.00", "40")).toBe("6000.00");
    expect(convertMoney("12.37", "36.712345")).toBe("454.13");
    expect(convertMoney("0.01", "40")).toBe("0.40");
    expect(convertMoney("1000.00", "0.002577")).toBe("2.58");
  });

  it("redondea half-up, igual que round() de Postgres", () => {
    // Los mismos casos frontera que lineSubtotal. Comprobado ademas contra la
    // base: 400 pares (monto, tasa) al azar dan identico a round(x*r, 2) de
    // Postgres, asi que la vista previa y lo guardado nunca difieren.
    expect(convertMoney("1.00", "1.005")).toBe("1.01");
    expect(convertMoney("0.01", "1.5")).toBe("0.02");
    expect(convertMoney("0.01", "2.5")).toBe("0.03");
  });

  it("no acumula error de punto flotante", () => {
    // Con numbers de JS, 0.07 * 36.5 = 2.5549999999999997
    expect(convertMoney("0.07", "36.5")).toBe("2.56");
    // Cien conversiones de 19.99 a tasa 40, sumadas, dan exacto.
    const convertidos = Array.from({ length: 100 }, () =>
      convertMoney("19.99", "40"),
    );
    expect(sumMoney(convertidos)).toBe("79960.00");
  });

  it("una tasa invalida revienta en vez de devolver cualquier cosa", () => {
    expect(() => convertMoney("10.00", "0")).toThrow(/invalida/i);
    expect(() => convertMoney("10.00", "-1")).toThrow(/invalida/i);
  });
});
