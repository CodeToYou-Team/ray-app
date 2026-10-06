import { PageTransition } from "@/components/motion";
import { FieldManager } from "@/components/fields/field-manager";
import { requireTenant } from "@/lib/authz/session";
import { roleHas } from "@/lib/authz/roles";
import { SinPermiso } from "@/components/layout/sin-permiso";
import { loadFieldConfig } from "@/lib/fields/queries";
import { resolveFields } from "@/lib/fields/resolve";
import { CATALOGS, CATALOG_KEYS } from "@/lib/catalogs/keys";

/**
 * Administracion de columnas.
 *
 * Exige `field:manage` en la propia pagina, no solo en las acciones: cambiar el
 * esquema de datos de un cliente no es una operacion del dia a dia y quien no
 * puede hacerlo tampoco deberia ver la pantalla.
 */
export default async function ColumnasPage() {
  const { tenantId, role } = await requireTenant();

  if (!roleHas(role, "field:manage")) {
    return <SinPermiso role={role} explicacion={"Solo el dueño puede cambiar qué información se guarda de productos y servicios."} />;
  }

  const config = await loadFieldConfig(tenantId);

  // Con archivadas y ocultas: esta es justamente la pantalla que las administra.
  const opciones = { includeArchived: true, includeHidden: true };

  const conId = (entity: "product" | "service") =>
    resolveFields(entity, config, opciones).map((f) => ({
      ...f,
      id: config.find((c) => c.entity === entity && c.key === f.key)?.id,
    }));

  return (
    <PageTransition>
      <FieldManager
        productFields={conId("product")}
        serviceFields={conId("service")}
        catalogKeys={CATALOG_KEYS.map((key) => ({
          key,
          label: CATALOGS[key].label,
        }))}
      />
    </PageTransition>
  );
}
