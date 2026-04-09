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
import { serviceCategories, getServiceById } from "@/lib/mock-data";

const serviceSchema = z.object({
  name: z.string().min(2, "Mínimo 2 caracteres"),
  description: z.string().min(5, "Mínimo 5 caracteres"),
  category: z.string().min(1, "Selecciona una categoría"),
  price: z.coerce.number().positive("Debe ser mayor a 0"),
  duration: z.string().optional(),
  active: z.boolean(),
});

type ServiceFormValues = z.infer<typeof serviceSchema>;

export default function EditarServicioPage() {
  const router = useRouter();
  const params = useParams();
  const service = getServiceById(params.id as string);

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema) as never,
    defaultValues: service
      ? {
          name: service.name,
          description: service.description,
          category: service.category,
          price: service.price,
          duration: service.duration || "",
          active: service.active,
        }
      : {
          name: "",
          description: "",
          category: "",
          price: 0,
          duration: "",
          active: true,
        },
  });

  function onSubmit(data: ServiceFormValues) {
    console.log("Update service:", { id: params.id, ...data });
    router.push("/productos");
  }

  if (!service) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Servicio no encontrado</p>
        <Button variant="ghost" size="sm" className="mt-2" asChild>
          <Link href="/productos">Volver</Link>
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
            <h2 className="text-lg font-bold">Editar Servicio</h2>
            <p className="text-sm text-muted-foreground">{service.name}</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Información del servicio</CardTitle>
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
                            {serviceCategories.map((cat) => (
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
                    name="duration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          Duración{" "}
                          <span className="text-muted-foreground">
                            (opcional)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input className="h-9 text-sm" {...field} />
                        </FormControl>
                        <FormMessage className="text-[11px]" />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Precio/Tarifa (MXN)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          className="h-9 text-sm w-48"
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
                          Los servicios activos aparecen en el catálogo
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

