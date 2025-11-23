# ORDERFLOW

An AI-powered restaurant order management system that processes customer SMS messages, automatically detects orders, and provides a real-time dashboard for restaurant managers.

## Overview

ORDERFLOW connects restaurants with customers via SMS (Twilio), uses AI to automatically detect orders from conversations, and provides a web dashboard for managing orders, conversations, and menu items.

## Core Flow

### 1. **Incoming SMS** → Webhook Processing
- Customer sends SMS to restaurant's Twilio number
- Webhook endpoint (`/sms/reply`) receives the message
- System creates or finds existing order/conversation
- Message is saved to database

### 2. **AI Processing** → Order Detection
When a new message arrives, the system automatically:
- **Analyzes the conversation** using AI (OpenAI or Trucube) to detect if an order was placed
- **Extracts order details**: items, quantities, prices, pickup time, customer name
- **Detects pickup times** (handles relative times like "in 1 hour" or absolute times like "3:30 PM")
- **Generates suggested responses** for the restaurant manager to send back

### 3. **Real-time Updates** → Dashboard
- Server-Sent Events (SSE) push updates to connected clients
- Dashboard shows:
  - Live conversation view
  - AI-detected order summary
  - Suggested response templates
  - Order queue with status tracking

### 4. **Outgoing Messages** → Customer Communication
- Restaurant manager can send messages through the dashboard
- Messages are sent via Twilio relay service
- AI suggestions help craft quick responses

## AI Functionality

### Order Detection (`analyzeOrderSummaryFromConversation`)
- Analyzes full conversation history to detect orders
- Matches mentioned items to menu items with prices
- Extracts customer name, items, quantities, pickup time, and notes
- Handles edge cases (e.g., "half sandwich" → converts to "Lunch special")
- Converts relative times ("in 30 minutes") to absolute times based on current time

### Pickup Time Detection (`detectPickupTimeFromConversation`)
- Specifically focuses on extracting pickup times from conversations
- Handles time format variations (with/without AM/PM)
- Detects when pickup time changes during conversation
- Recognizes confirmed times (when restaurant proposes and customer confirms)

### AI Suggested Responses (`generateAISuggestedResponse`)
- Generates natural, brief responses for restaurant managers
- Only suggests when customer sends the last message (not when manager just replied)
- Keeps responses casual and human-sounding (10-20 words)
- Cached per order to avoid redundant API calls

### Conditional AI Output (`analyzeConditionalAIOutput`) - Work In Progress
- Handles special edge cases that need custom logic
- Currently handles "half sandwich" requests
- Can generate both order summary and suggested response for edge cases

## Architecture

### Backend (`/server`)
- **Express.js** server with TypeScript
- **PostgreSQL** database (Drizzle ORM)
- **Redis** for caching and SSE event distribution (production)
- **Session management** with PostgreSQL session store
- **Passport.js** for authentication

### Frontend (`/client`)
- **React** with TypeScript
- **Vite** for build tooling
- **TanStack Query** for data fetching
- **Wouter** for routing
- **Radix UI** components with Tailwind CSS
- **Server-Sent Events** for real-time updates

### Key Services
- `main.service.ts` - Handles SMS webhooks and SSE connections
- `conversations.services.ts` - Manages message sending and AI order detection
- `orders.service.ts` - Order CRUD operations
- `menu.service.ts` - Menu item management
- `twilio.service.ts` - Twilio opt-in/opt-out handling
- `clover.service.ts` - Clover POS integration

### AI Integration
- Supports **OpenAI** or **Trucube** models
- Set `MODEL=TRUCUBE` environment variable to use Trucube
- All AI functions in `aiFunctions.ts` with prompts in `utils.ts`

## Database Schema

Key tables:
- `users` - Restaurant owners/managers
- `orders` - Order records with status, pickup time, customer info
- `order_conversations` - Stores all messages as JSON array per order
- `menu_items` - Restaurant menu with prices and categories
- `customers` - Customer information and stats
- `order_history` - Historical order data
- `menu_item_popularity_aggregates` - Pre-aggregated popularity metrics

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Redis (optional, for production SSE scaling)
- Twilio account (for SMS)

### Environment Variables
```env
# Database
DATABASE_URL=postgresql://...

# Session
SESSION_SECRET=your-secret-key

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...

# AI
OPENAI_API_KEY=... # or use TRUCUBE
MODEL=OPENAI # or TRUCUBE

# Optional
REDIS_URL=redis://... # for production SSE
PRODUCTION=true # enables Redis SSE and order detection timers
TWILIO_CAMPAIGN=true # enables opt-in/opt-out flow
```

### Installation
```bash
npm install
npm run db:push  # Push database schema
npm run dev      # Start development server
```

## Key Features

- ✅ **Automatic order detection** from SMS conversations
- ✅ **Real-time dashboard** with live conversation updates
- ✅ **AI-suggested responses** to help managers reply quickly
- ✅ **Menu management** with item prices and categories
- ✅ **Order queue** with status tracking (New → Confirmed → Ready → Completed)
- ✅ **Pickup time detection** with smart time parsing
- ✅ **Customer history** and order tracking
- ✅ **Analytics** for menu item popularity
- ✅ **Clover POS integration** (optional)
- ✅ **Twilio Campaign opt-in/opt-out** support

## Project Structure

```
ORDERFLOW/
├── client/          # React frontend
│   └── src/
│       ├── pages/   # Route pages
│       ├── components/  # UI components
│       └── providers/  # React providers
├── server/          # Express backend
│   ├── controllers/ # Route controllers
│   ├── services/    # Business logic
│   ├── routes/      # API routes
│   ├── aiFunctions.ts  # AI order detection
│   └── utils.ts     # Utilities & AI prompts
├── shared/          # Shared types & schemas
└── migrations/      # Database migrations
```

## Development

- Frontend dev server: Vite HMR (via Express in dev mode)
- Backend: `tsx server/index.ts` with hot reload
- Database: Drizzle ORM with migrations
- Type safety: Shared TypeScript types in `/shared`

## Production

- Build: `npm run build` (bundles both client and server)
- Start: `npm start` (runs `dist/index.js`)
- SSE scaling: Requires Redis when `PRODUCTION=true`
- Session store: PostgreSQL (configured automatically)

