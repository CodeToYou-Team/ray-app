"use client";

import { motion } from "framer-motion";

/**
 * Una sola forma de aparecer.
 *
 * Antes cada pieza elegia sus propios numeros (0.25/0.35, y:8/12/16) y
 * `PageTransition` envolvia el contenido en `AnimatePresence` con un `exit`
 * que nunca corria: al cambiar de ruta Next desmonta el arbol entero, asi que
 * no hay salida que animar. Se quito la promesa falsa y quedaron dos
 * duraciones con nombre.
 */

const DURACION = 0.3;
const DESPLAZAMIENTO = 8;
const ESCALONADO = 0.05;

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: DESPLAZAMIENTO }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURACION, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: DESPLAZAMIENTO }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURACION, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: ESCALONADO } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: DESPLAZAMIENTO },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: DURACION, ease: "easeOut" },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
