"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/authz/session";
import {
  registerProduct,
  updateProduct as updateProductCore,
  archiveProduct as archiveProductCore,
  adjustStock as adjustStockCore,
  registerService,
  updateService as updateServiceCore,
  archiveService as archiveServiceCore,
  type ProductInput,
  type ServiceInput,
  type ItemResult,
} from "./register";

/**
 * Server Actions de productos y servicios.
 *
 * Envoltorios finos: exigen el permiso y delegan en ./register.ts. Cada uno es
 * un endpoint POST publico, asi que el permiso se verifica aqui y no en el
 * componente que pinta el boton.
 */

export type { ProductInput, ServiceInput, ItemResult };

function revalidateCatalogo() {
  revalidatePath("/productos");
  revalidatePath("/servicios");
  revalidatePath("/servicios/[id]", "page");
  revalidatePath("/inventario");
  revalidatePath("/dashboard");
}

export async function createProduct(input: ProductInput): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await registerProduct({ tenantId, userId: user.id }, input);
  } finally {
    revalidateCatalogo();
  }
}

export async function editProduct(
  id: string,
  input: ProductInput,
): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await updateProductCore({ tenantId, userId: user.id }, id, input);
  } finally {
    revalidateCatalogo();
  }
}

export async function setProductArchived(
  id: string,
  archived: boolean,
): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await archiveProductCore({ tenantId, userId: user.id }, id, archived);
  } finally {
    revalidateCatalogo();
  }
}

/** Ajuste manual de inventario. Permiso propio: no es lo mismo que editar. */
export async function adjustStock(input: {
  productId: string;
  delta: string;
  reason: "ajuste" | "merma";
  note?: string;
}): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("stock:adjust");
  try {
    return await adjustStockCore({ tenantId, userId: user.id }, input);
  } finally {
    revalidateCatalogo();
  }
}

export async function createService(input: ServiceInput): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await registerService({ tenantId, userId: user.id }, input);
  } finally {
    revalidateCatalogo();
  }
}

export async function editService(
  id: string,
  input: ServiceInput,
): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await updateServiceCore({ tenantId, userId: user.id }, id, input);
  } finally {
    revalidateCatalogo();
  }
}

export async function setServiceArchived(
  id: string,
  archived: boolean,
): Promise<ItemResult> {
  const { tenantId, user } = await requireCapability("product:manage");
  try {
    return await archiveServiceCore({ tenantId, userId: user.id }, id, archived);
  } finally {
    revalidateCatalogo();
  }
}
