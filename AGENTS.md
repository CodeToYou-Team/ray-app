# AGENTS.md

## Commands

- `pnpm dev` - Start dev server (http://localhost:3000)
- `pnpm build` - Production build
- `pnpm start` - Start production server
- `pnpm lint` - ESLint (no typecheck command exists)

## Tech Stack

- Next.js 16.2.2 (App Router)
- React 19.2.3
- TypeScript
- Tailwind CSS 4 (uses CSS variables, not tailwind.config.js)
- pnpm

## Architecture

- `/app` - Next.js App Router pages (dashboard, inventario, productos, finanzas)
- `/components/ui` - Shadcn-style Radix UI components
- `/components/dashboard` - Dashboard-specific components
- `/components/finanzas` - Finance-specific components
- `/lib` - Utilities (utils.ts, mock-data.ts)

## Conventions

- Language: Spanish throughout (UI, metadata, content)
- Theme: `next-themes` with light/dark mode via CSS variables
- Fonts: Plus Jakarta Sans + IBM Plex Mono (via next/font/google)
- Forms: react-hook-form + Zod for validation
- No database yet (uses mock-data.ts)

## Important

- No typecheck script in package.json
- No test setup configured
- No pre-commit hooks
- No .env files (none needed currently)