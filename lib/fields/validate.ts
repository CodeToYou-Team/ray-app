import { isMoney, isQuantity, normalizeMoney } from "@/lib/money";
import { activeOptions, type ResolvedField } from "./resolve";

/**
 * Validacion de los campos personalizados, generada desde sus definiciones.
 *
 * Es la misma funcion en el navegador y en el servidor, que es lo que evita que
 * el formulario acepte algo que la accion despues rechaza (o peor: que el
 * servidor acepte algo que el formulario nunca habria dejado escribir).
 *
 * La asimetria que si existe y no se disimula: al ESCRIBIR se valida estricto
 * contra la definicion actual; al LEER no se valida nada. Un producto guardado
 * antes de que se agregara un campo requerido tiene que poder abrirse,
 * listarse y exportarse igual. Si la validacion estricta corriera al leer, el
 * dia que un cliente marque un campo como requerido, todo su historico se
 * volveria imposible de mostrar.
 */

export interface FieldIssue {
  key: string;
  message: string;
}

export type CustomValues = Record<string, unknown>;

function vacio(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Valida y NORMALIZA los valores personalizados.
 *
 * Devuelve solo las claves de campos activos: si un campo fue archivado, su
 * valor se deja de escribir pero el que ya estaba en la fila no se toca.
 */
export function validateCustomValues(
  fields: ResolvedField[],
  raw: CustomValues,
): { ok: true; values: CustomValues } | { ok: false; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const values: CustomValues = {};

  for (const field of fields) {
    if (field.source !== "custom" || field.archived) continue;

    const entrada = raw[field.key];

    if (vacio(entrada)) {
      if (field.required) {
        issues.push({ key: field.key, message: `${field.label} es obligatorio` });
      }
      // Un campo vacio no se guarda: asi el JSONB no se llena de nulls y
      // `custom ? 'clave'` sigue significando "tiene valor".
      continue;
    }

    const resultado = validateOne(field, entrada);
    if ("error" in resultado) {
      issues.push({ key: field.key, message: resultado.error });
    } else {
      values[field.key] = resultado.value;
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}

function validateOne(
  field: ResolvedField,
  entrada: unknown,
): { value: unknown } | { error: string } {
  const texto = typeof entrada === "string" ? entrada.trim() : entrada;

  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof texto !== "string") {
        return { error: `${field.label} debe ser texto` };
      }
      const max = Number(field.config.max ?? (field.type === "text" ? 200 : 2000));
      if (texto.length > max) {
        return { error: `${field.label}: máximo ${max} caracteres` };
      }
      return { value: texto };
    }

    case "number":
    case "integer": {
      const s = String(texto);
      if (field.type === "integer" && !/^-?\d+$/.test(s)) {
        return { error: `${field.label} debe ser un número entero` };
      }
      if (field.type === "number" && !isQuantity(s)) {
        return { error: `${field.label} debe ser un número` };
      }
      const n = Number(s);
      if (!Number.isFinite(n)) {
        return { error: `${field.label} debe ser un número` };
      }
      if (field.config.min !== undefined && n < Number(field.config.min)) {
        return { error: `${field.label}: mínimo ${field.config.min}` };
      }
      if (field.config.max !== undefined && n > Number(field.config.max)) {
        return { error: `${field.label}: máximo ${field.config.max}` };
      }
      // Se guarda como numero, no como string: es un valor numerico, no dinero.
      return { value: field.type === "integer" ? Math.trunc(n) : n };
    }

    case "money": {
      const s = String(texto);
      if (!isMoney(s)) {
        return { error: `${field.label}: usa números con hasta 2 decimales` };
      }
      // Como string, igual que el resto del dinero del sistema.
      return { value: normalizeMoney(s) };
    }

    case "boolean": {
      if (typeof entrada === "boolean") return { value: entrada };
      if (entrada === "true" || entrada === "false") {
        return { value: entrada === "true" };
      }
      return { error: `${field.label} debe ser sí o no` };
    }

    case "date": {
      const s = String(texto);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return { error: `${field.label}: fecha inválida` };
      }
      if (Number.isNaN(new Date(`${s}T00:00:00`).getTime())) {
        return { error: `${field.label}: fecha inválida` };
      }
      return { value: s };
    }

    case "select":
    case "catalog": {
      const s = String(texto);
      // `catalog` se valida contra la base en el servidor; aqui solo la forma.
      if (field.type === "select") {
        const validas = activeOptions(field).map((o) => o.code);
        if (!validas.includes(s)) {
          return { error: `${field.label}: esa opción ya no está disponible` };
        }
      }
      return { value: s };
    }

    case "multiselect": {
      const lista = Array.isArray(entrada) ? entrada.map(String) : [String(texto)];
      const validas = new Set(activeOptions(field).map((o) => o.code));
      const invalida = lista.find((v) => !validas.has(v));
      if (invalida) {
        return { error: `${field.label}: "${invalida}" ya no está disponible` };
      }
      // Sin duplicados y en orden estable, para que dos guardados iguales
      // produzcan el mismo JSONB.
      return { value: [...new Set(lista)].sort() };
    }
  }
}

/**
 * Prepara los valores guardados para mostrarlos en un formulario.
 *
 * No valida: un valor que hoy seria invalido (una opcion archivada, un campo
 * que ahora es requerido) se devuelve igual, porque era valido cuando se
 * escribio y el usuario tiene que poder verlo.
 */
export function toFormValues(
  fields: ResolvedField[],
  stored: CustomValues | null | undefined,
): CustomValues {
  const values: CustomValues = {};
  for (const field of fields) {
    if (field.source !== "custom") continue;
    const actual = stored?.[field.key];
    values[field.key] =
      actual ?? (field.type === "multiselect" ? [] : field.type === "boolean" ? false : "");
  }
  return values;
}
