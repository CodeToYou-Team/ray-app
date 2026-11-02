import type { Metadata } from "next";
import { PageTransition } from "@/components/motion";
import { TenantList } from "@/components/admin/tenant-list";
import { requirePlatformAdmin } from "@/lib/authz/session";
import { listTenants } from "@/lib/admin/tenants";
import { signupUrlFromHeaders } from "@/lib/authz/signup-url";

export const metadata: Metadata = {
  title: "Negocios — Administración",
};

export default async function AdminPage() {
  const admin = await requirePlatformAdmin();
  const [tenants, signupUrl] = await Promise.all([
    listTenants(admin.id),
    signupUrlFromHeaders(),
  ]);

  return (
    <PageTransition>
      <TenantList tenants={tenants} signupUrl={signupUrl} />
    </PageTransition>
  );
}
