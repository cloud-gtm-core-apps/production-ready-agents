# Technology Stack

This project leverages a modern full-stack TypeScript environment optimized for real-time AI processing and dashboard management.

## Core Stack
- **Language:** TypeScript (Strict Mode)
- **Runtime:** Node.js (v18+)
- **Package Manager:** npm

## Frontend
- **Framework:** React (v18)
- **Build Tool:** Vite
- **Routing:** Wouter (Lightweight routing)
- **State Management:** TanStack Query (React Query)
- **Styling:** Tailwind CSS (v3), Radix UI (Headless components), Lucide React (Icons)
- **Animation:** Framer Motion, tailwindcss-animate

## Backend
- **Framework:** Express.js
- **API Style:** RESTful JSON API
- **Authentication:** Passport.js (Local Strategy), `express-session`, `connect-pg-simple`
- **Security:** bcrypt (Password hashing)

## Database & Persistence
- **Primary Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Schema Validation:** Zod (using `drizzle-zod` for shared schemas)
- **Caching/Real-time:** Redis (ioredis) for SSE/Scaling support

## Integrations & Services
- **AI/LLM:** OpenAI SDK (supporting OpenAI and Trucube models)
- **Communications:** Twilio SDK (SMS integration)
- **Point of Sale (POS):** Clover API integration

## Infrastructure & Tooling
- **Database Migrations:** Drizzle Kit
- **Development Tools:** tsx (TypeScript execution), esbuild (Backend bundling)
- **Real-time Updates:** Server-Sent Events (SSE) and WebSockets (ws)
