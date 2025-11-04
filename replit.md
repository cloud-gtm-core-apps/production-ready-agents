# Corn on the Corner - Order Management System

## Overview

Corn on the Corner is a text-to-order management system for a street food vendor in Dearborn, Michigan. The application provides an iPhone-native interface that mimics messaging apps (iMessage-style) for Rod (the store manager) to view and manage incoming text orders efficiently. The demo showcases the complete 4-stage order workflow (New → Confirmed → Ready → Completed) with realistic Dearborn demographic names and features like time-based alerts, repeat customer recognition, and editable order summaries.

## User Preferences

Preferred communication style: Simple, everyday language.

## Current Features

**Demo Data:**
- 19 conversations total (8 NEW, 4 CONFIRMED, 3 READY, 4 COMPLETED)
- Arab American names common in Dearborn, MI demographic (Fatima, Ahmed, Nour, Layla, Hassan, Zainab, Youssef, Rania, Omar, Maryam, Ali, Dina, Karim, Sara, Hadi, Mariam, Bilal, Lina, Tariq)
- Corn-focused menu items (Classic Elote Cup, Buffalo Ranch Elote, Flamin Hot Cheetos Elote, Bacon Cheddar Elote, Nacho Cheese Elote, Corn Ribs, Street Corn Dog, Churro Bites, Tajin Fries)
- All conversation messages synchronized with order details and notes for data consistency
- Scrollable message lists for each tab
- Natural conversation flow without price mentions in messages
- Complete workflow demonstration from new order through pickup completion

**Time-Based Smart Badges:**
- **URGENT** badge: ONLY appears on 'confirmed' or 'ready' orders when pickup time < 10 minutes (never shows on 'new' orders)
- **RUNNING LATE** badge: Shows only for CONFIRMED orders past their pickup time
- All calculations use live timestamps (demo works at any runtime)
- NEW status orders never show URGENT badges regardless of pickup time

**Repeat Customer Recognition:**
- 2nd order, 3rd order, 4th order badges with proper ordinal suffixes
- VIP (8x), VIP (9x), etc. for customers with 8+ orders
- Badges display consistently in both message list and conversation view

**Message Interface:**
- Rod's messages (outgoing): Anchored to RIGHT side with primary/gold background
- Customer messages (incoming): Anchored to LEFT side with muted/gray background
- iMessage-style chat bubbles with timestamps
- No annoying notification popups (removed NotificationBanner)
- System greeting message starts each conversation

**AI Organization Demo (Fatima Conversation):**
- Demonstrates AI-powered message organization for messy customer texts
- Shows raw incoming message followed by AI-organized structured version
- **AI-organized messages** displayed with:
  - Distinctive purple background (bg-purple-600) and purple border
  - "✨ AI Organized" badge at the top with sparkle icon
  - Multi-line formatted output with customer name, items (each on separate line), customizations, and pickup time
  - Example transformation: "hey its fatima can i get 2 classic elote cups and 1 flaming hot extra spicy 15min" → structured format with clear line breaks
- AI captures and structures: customer name, item list, special requests, and pickup time
- Order summary automatically populated from AI-structured data

**AI Response Suggestions (Nour Conversation):**
- Demonstrates AI-generated responses to informational questions
- Customer asks: "are you guys open at 8pm"
- **AI-suggested response card** appears with:
  - Purple theme styling (bg-purple-900/20, border-purple-500/30)
  - Sparkles icon and "AI Suggested Response" label
  - Tappable suggestion button displaying: "Yes! We're open until 9 PM daily. Come by anytime!"
  - "Tap to use this response" instruction text
- One-tap to populate message input with suggested response
- Helps Rod answer common questions quickly and consistently

**Send Message Functionality:**
- Fully functional message input field with iMessage-style interface
- **Send button:** Gold circular button with up arrow icon (↑)
  - Disabled when input is empty (reduced opacity)
  - Active and clickable when text is entered
- **Multiple send methods:**
  - Click/tap send button
  - Press Enter key
- **Message handling:**
  - Messages appear immediately in chat with current timestamp
  - Timestamp format: 12-hour with AM/PM (e.g., "2:45 PM")
  - Rod's messages display on right side with gold/primary background
  - Unique message IDs generated using timestamp + random string
  - Input field clears automatically after sending
- **Auto-scroll behavior:**
  - Conversations automatically scroll to latest message when opened
  - Auto-scroll to bottom after sending new message
  - Smooth scrolling for better UX
- Integrates seamlessly with AI suggestions (tap suggestion → send → message appears)
- State management uses functional updates to prevent race conditions

**Quick Reply Templates:**
- Floating button with common responses
- Templates: "Your order is ready!", "What's your name?", "Total confirmed"
- Click to insert template text into message input

**Editable Order Summary:**
- **Collapsible interface:** Chevron toggle button to collapse/expand order details
- **Collapsed view:** Shows condensed summary "{count} items • ${total} • {pickupTime}"
- **Expanded view:** Shows full item list, notes, pickup time, and total
- Toggle between view and edit modes
- Quantity controls (+/- buttons) with dynamic total updates
- Add new items functionality
- Notes field for special instructions
- Edit button hidden for ready and completed orders
- All changes save and persist

**Quick Actions:**
- "Mark Ready" button appears directly on CONFIRMED order cards in the message list
- "Mark Picked Up" button appears on READY order cards to complete the order
- One-tap workflow to move orders through stages without opening conversations
- Reduces clicks and speeds up order management during busy periods
- Buttons styled with gold theme and checkmark icon for clear visual feedback

**Navigation & Multi-Employee Features:**
- Hamburger menu opens sliding navigation drawer from left
- Drawer organized into 4 sections: Operations, Management, Team, Account
- Demonstrates multi-employee capability with user management features
- Smooth slide-in/out animations contained within iPhone frame
- Backdrop overlay with click-to-close functionality
- Active "Orders" section highlighted with gold accents

**Visual Design:**
- Bold black + gold rebrand matching official website (cornonthecorner.com)
- Deep black backgrounds (#000000) with vibrant gold accents (hsl 45° 95% 55%)
- iPhone-native messaging interface (393x852px viewport)
- Premium street food aesthetic throughout all components

## System Architecture

### Frontend Architecture

**Technology Stack:**
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite for fast development and optimized production builds
- **Routing:** Wouter for lightweight client-side routing
- **State Management:** TanStack Query (React Query) for server state management
- **UI Framework:** Shadcn/ui with Radix UI primitives for accessible components
- **Styling:** Tailwind CSS with custom design system following brand guidelines

**Design System:**
The application implements a bold black + gold brand identity matching the official Corn on the Corner website:
- Primary colors: Deep black (#000000) backgrounds with vibrant gold accents (hsl 45° 95% 55-60%)
- Secondary UI: Dark grays for message bubbles, borders, and subtle elements
- iPhone 14 Pro specifications (393x852px viewport) with safe area handling
- Message-based interface inspired by iMessage for customer interactions
- Navigation drawer demonstrates enterprise/multi-employee capabilities
- Z-index layering: Content (z-10), Drawer backdrop (z-40), Drawer panel (z-50)

**Component Architecture:**
- Reusable UI components in `client/src/components/ui/` (Shadcn/ui library)
- Feature-specific components in `client/src/components/`:
  - `IPhoneFrame`: Device frame wrapper for mobile-first presentation
  - `SideDrawer`: Sliding navigation menu with multi-employee features (absolutely positioned within frame)
  - `ConversationView`: iMessage-style chat interface with send message functionality and auto-scroll
  - `MessageList`: Order list view with "Orders" header and hamburger menu
  - `TabBar`: Bottom navigation for order status filtering (New/Confirmed/Ready/Completed)
  - `MessageBubble`: Chat-style message display with left/right alignment
  - `QuickReplyTemplates`: Common response templates
  - `EditableOrderSummary`: Collapsible order summary with toggle-able editing and quantity controls
  - `AISuggestedResponse`: Purple-themed AI suggestion cards with tap-to-use functionality

**State Management Strategy:**
- TanStack Query handles all server state with configurable refetch behavior
- Local component state for UI interactions
- Query client configured with infinite stale time for static data

### Backend Architecture

**Technology Stack:**
- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js for RESTful API
- **Database ORM:** Drizzle ORM
- **Database:** PostgreSQL (via Neon serverless)
- **Session Management:** Connect-pg-simple for PostgreSQL session storage

**API Design:**
- RESTful endpoints prefixed with `/api`
- Request/response logging middleware for debugging
- JSON request body parsing with raw body preservation for webhooks
- Centralized error handling

**Data Layer:**
Currently implements an in-memory storage abstraction (`MemStorage`) with interface-based design (`IStorage`) that allows easy migration to database persistence. The storage interface supports:
- User CRUD operations
- UUID-based entity identification

**Database Schema (Planned):**
Using Drizzle ORM with PostgreSQL:
- `users` table with UUID primary keys, username/password authentication
- Schema defined in `shared/schema.ts` with Zod validation
- Migration support via `drizzle-kit`

**Session Management:**
- PostgreSQL-backed sessions via `connect-pg-simple`
- Secure cookie-based authentication
- Session persistence across server restarts

### Development Architecture

**Monorepo Structure:**
```
/client          - React frontend
/server          - Express backend
/shared          - Shared TypeScript types and schemas
/migrations      - Database migrations
/attached_assets - Design documentation and assets
```

**Build Process:**
- Development: Vite dev server with HMR, TSX execution for backend
- Production: Vite builds frontend to `dist/public`, esbuild bundles backend to `dist`
- Type checking: Shared TypeScript configuration across client/server

**Development Tools:**
- Replit-specific plugins for enhanced development experience
- Runtime error overlay for better debugging
- Cartographer for code navigation
- Development banner for environment awareness

**Path Aliases:**
- `@/*` → `client/src/*` for frontend imports
- `@shared/*` → `shared/*` for shared code
- `@assets/*` → `attached_assets/*` for static assets

### Design Patterns

**Frontend Patterns:**
- Component composition with Radix UI primitives
- Render props pattern for flexible UI components
- Custom hooks for reusable logic (`use-mobile`, `use-toast`)
- CSS-in-JS via Tailwind with design token system (HSL color variables)

**Backend Patterns:**
- Repository pattern with storage abstraction layer
- Middleware chain for request processing
- Environment-based configuration
- Graceful error handling with status code mapping

**Type Safety:**
- End-to-end TypeScript with strict mode enabled
- Drizzle-Zod integration for runtime validation
- Shared schema definitions between client and server
- Type inference from database schema

## External Dependencies

### Third-Party Services

**Database:**
- Neon Serverless PostgreSQL for production data storage
- Configured via `DATABASE_URL` environment variable
- WebSocket-based serverless driver for edge compatibility

### UI Libraries

**Component Libraries:**
- Shadcn/ui: Pre-built accessible components built on Radix UI
- Radix UI: Unstyled, accessible component primitives (20+ components)
- Lucide React: Icon library for consistent iconography
- CMDK: Command palette component for keyboard navigation

**Styling:**
- Tailwind CSS: Utility-first CSS framework
- Class Variance Authority: Type-safe variant generation
- Autoprefixer: Automatic vendor prefixing

### Utility Libraries

**Form Management:**
- React Hook Form: Performant form handling
- Hookform Resolvers: Schema validation integration
- Zod: TypeScript-first schema validation

**Date/Time:**
- date-fns: Modern date utility library for formatting and manipulation

**Animation:**
- Embla Carousel: Lightweight carousel library
- Tailwind CSS animations: Built-in animation utilities

### Development Dependencies

**Build Tools:**
- Vite: Next-generation frontend tooling
- esbuild: Fast JavaScript bundler for backend
- TSX: TypeScript execution for development

**Type Definitions:**
- @types/node: Node.js type definitions
- vite/client: Vite-specific type definitions

### API Integration Points

**Current State:**
The application is designed to integrate with:
- Google Maps for location/discovery
- iMessage for customer communication (existing workflow)
- Future SMS/messaging APIs for automated order processing

**Authentication:**
- Session-based authentication with PostgreSQL storage
- Cookie-based session management
- User credentials stored with hashed passwords (implementation pending)