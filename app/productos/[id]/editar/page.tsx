"use client";

import { useRouter, useParams } from "next/navigation";
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
import {
  productCategories,
  getProductById,
  formatCurrency,
} from "@/lib/mock-data";

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

export default function EditarProductoPage() {
  const router = useRouter();
  const params = useParams();
  const product = getProductById(params.id as string);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema) as never,
    defaultValues: product
      ? {
          name: product.name,
          description: product.description,
          category: product.category,
          purchasePrice: product.purchasePrice,
          salePrice: product.salePrice,
          sku: product.sku,
          stock: product.stock,
          active: product.active,
        }
      : {
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
    console.log("Update product:", { id: params.id, ...data });
    router.push("/productos");
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Producto no encontrado</p>
        <Button variant="ghost" size="sm" className="mt-2" asChild>
          <Link href="/productos">Volver a productos</Link>
        </Button>
      </div>
    );
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
            <h2 className="text-lg font-bold">Editar Producto</h2>
            <p className="text-sm text-muted-foreground">{product.name}</p>
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
                      <FormLabel className="text-xs">Nombre</FormLabel>
                      <FormControl>
                        <Input className="h-9 text-sm" {...field} />
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
                              <SelectValue />
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
                          <Input className="h-9 text-sm" {...field} />
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
                        <FormLabel className="text-xs">Precio compra</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
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
                        <FormLabel className="text-xs">Precio venta</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
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
                      <FormLabel className="text-xs">Stock actual</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
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

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <Link href="/productos">Cancelar</Link>
                  </Button>
                  <Button type="submit" size="sm">
                    Guardar cambios
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

