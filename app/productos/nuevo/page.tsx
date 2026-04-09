"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageTransition } from "@/components/motion";
import { productCategories, formatCurrency } from "@/lib/mock-data";

const productSchema = z.object({
  name: z.string().min(2, "Mínimo 2 caracteres"),
  description: z.string().min(5, "Mínimo 5 caracteres"),
  category: z.string().min(1, "Selecciona una categoría"),
  purchasePrice: z.coerce.number().nonnegative("Debe ser 0 o mayor"),
  salePrice: z.coerce.number().positive("Debe ser mayor a 0"),
  sku: z.string().min(2, "Mínimo 2 caracteres"),
  stock: z.coerce.number().nonnegative("Debe ser 0 o mayor").int(),
  active: z.boolean(),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function NuevoProductoPage() {
  const router = useRouter();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as never,
    defaultValues: {
      name: "",
      description: "",
      category: "",
      purchasePrice: 0,
      salePrice: 0,
      sku: "",
      stock: 0,
      active: true,
    },
  });

  const salePrice = form.watch("salePrice");
  const purchasePrice = form.watch("purchasePrice");
  const margin =
    salePrice > 0 && purchasePrice > 0
      ? Math.round(((salePrice - purchasePrice) / salePrice) * 100)
      : 0;

  function onSubmit(data: ProductFormValues) {
    console.log("New product:", data);
    router.push("/productos");
  }

  return (
    <PageTransition>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link href="/productos">
              <IconArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-lg font-bold">Nuevo Producto</h2>
            <p className="text-sm text-muted-foreground">
              Completa la información para registrar un producto
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Información del producto</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-5"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Nombre del producto
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ej: Monitor UltraWide 34 pulgadas"
                          className="h-9 text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Descripción</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe el producto..."
                          className="text-sm resize-none h-20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Categoría</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {productCategories.map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {cat}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">SKU</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="MON-UW34"
                            className="h-9 text-sm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="purchasePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Precio de compra
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="0"
                            className="h-9 text-sm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="salePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Precio de venta
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="0"
                            className="h-9 text-sm"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <label className="text-xs font-medium">Margen</label>
                    <div className="flex items-center h-9 px-3 rounded-md bg-muted text-sm font-semibold">
                      {margin}%
                    </div>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Stock inicial</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0"
                          className="h-9 text-sm w-32"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                      <div>
                        <FormLabel className="text-xs">Estado activo</FormLabel>
                        <p className="text-[11px] text-muted-foreground">
                          Los productos activos aparecen en el catálogo
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Preview */}
                {form.watch("name") && (
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Vista previa
                    </p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">
                          {form.watch("name")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {form.watch("category") || "Sin categoría"} ·{" "}
                          {form.watch("sku") || "Sin SKU"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">
                          {formatCurrency(salePrice || 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Margen: {margin}%
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <Link href="/productos">Cancelar</Link>
                  </Button>
                  <Button type="submit" size="sm">
                    Guardar producto
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}

