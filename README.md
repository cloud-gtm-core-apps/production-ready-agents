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



## What is TRUCUBE::

what is Set MODEL=TRUCUBE environment variable to use Trucube ?? what is Trucube??
Copilot said: In your README, the following appears: > Set
In your README, the following appears:

Set MODEL=TRUCUBE environment variable to use Trucube

Here’s what it means and details about Trucube:

1. What does “Set MODEL=TRUCUBE environment variable to use Trucube” mean?
ORDERFLOW, your restaurant order management system, supports two different AI models:

OpenAI (likely GPT-3, GPT-4, or similar)
Trucube (another AI offering)
By default, the system uses OpenAI.
If you want to use Trucube instead, you need to set the environment variable called MODEL to TRUCUBE in your .env file or deployment configuration:

Code
MODEL=TRUCUBE
This tells the backend code to use Trucube for its AI operations (order detection, pickup time extraction, AI-generated suggested responses, etc.) instead of OpenAI.

2. What is Trucube?
From the context in the README:

Trucube appears to be an alternative to OpenAI for processing natural language and detecting orders from customer conversations.
It likely provides an API or SDK similar to OpenAI’s models—but with different capabilities, pricing, or customization.
The README does not provide external links or details about Trucube, so Trucube is either:
A third-party AI provider with its own NLP models (e.g., possibly an enterprise-focused service, less commonly known than OpenAI).
An internal or custom model/service developed specifically for this project or the company.
If your team or documentation does not explain it further, you may want to:

Check for other documentation, code comments (especially in aiFunctions.ts and utils.ts), or ask your colleagues.
Search online for “Trucube AI” or check if you have credentials/config info for Trucube.
Summary:

Setting MODEL=TRUCUBE switches your backend to use Trucube for AI processing.
Trucube is an alternative AI model to OpenAI, but details about its source or public availability are not specified in the README.
If you want me to identify how Trucube integration is coded in your repo (in aiFunctions.ts, etc.), just ask!

You said: they seem to use llama models with
they seem to use llama models with Trucube
Copilot said: Thanks for the follow-up! That provides a
Thanks for the follow-up! That provides a bit more context:

What Does That Mean?
If the README and code reference “Trucube” and you know that it uses Llama models, here’s what’s happening:

Llama is a family of open-source large language models created by Meta (Facebook), known for their strong natural language processing capabilities.
Trucube in your system appears to be a service (internal or third-party) that wraps, deploys, or exposes Llama models via an API.
So, when you set MODEL=TRUCUBE, your app switches its AI backend to “Trucube”, which actually runs Llama models under the hood, instead of using OpenAI’s models.

Why Do This?

Cost: Llama models may be cheaper to operate than using OpenAI’s commercial APIs.
Customization: You or Trucube might fine-tune these models for your specific restaurant/order use case.
Privacy & Control: If your company runs Trucube internally, data may stay in your infrastructure.
Usage in Code
With MODEL=TRUCUBE set, functions in your backend (aiFunctions.ts etc.) likely select the Trucube (Llama) API to:

Detect order summaries
Extract pickup times
Suggest responses
The system’s logic might look like this (conceptual example):

TypeScript
if (process.env.MODEL === 'TRUCUBE') {
  // Call Trucube API (which uses a Llama model)
  const aiResult = await trucubeOrderDetection(conversation);
} else {
  // Use OpenAI API
  const aiResult = await openaiOrderDetection(conversation);
}
Summary
Trucube is an abstraction in your application for an AI provider using Llama models, instead of OpenAI.
Setting MODEL=TRUCUBE tells ORDERFLOW’s backend to use Trucube’s Llama-powered API for its AI functions.
Trucube may be self-hosted, third-party, or internal, but its key feature is that behind the scenes it runs Llama.
If you want direct links to relevant lines in your repo’s code where Trucube or Llama is configured or used, just let me know!

You said: I still don't understand what Trucube is??
I still don't understand what Trucube is?? How does it compare to openai ??? 
Copilot said: Great questions! Let’s break it down clearly. --- ##
Great questions! Let’s break it down clearly.

1. What is Trucube (in your context)?
Based on your README and your comments:

Trucube is an "AI model provider" option in your ORDERFLOW system (like OpenAI).
When you set MODEL=TRUCUBE, your app uses Trucube’s API for natural language processing tasks—order detection, pickup time extraction, response suggestions.
You mentioned it uses Llama models under the hood.
So, Trucube is not a model itself.
It’s a service/platform/wrapper that lets your ORDERFLOW backend use Llama models (developed by Meta) for its AI features.

There isn’t public evidence of a “Trucube” company or open-source project widely known for AI.
That means it's likely:

An internal service at your company (your team may have called it Trucube).
A private third-party API your organization subscribes to, which serves Llama models and is branded as “Trucube.”
A code module in your repository that acts as the interface to a self-hosted Llama model.
Conclusion:
Trucube = an interface/API/service used by your ORDERFLOW app that is powered by Llama models.
It is analogous to, but distinct from, OpenAI’s API.

2. How does Trucube (Llama) compare to OpenAI?
Feature	OpenAI (GPT-3/4)	Trucube (Llama)
Model	Proprietary (GPT models)	Open-source (Llama models by Meta)
API Provider	OpenAI, cloud SaaS	Trucube API: internal/third party/self-hosted
Cost	Monthly usage, paid tier	Potentially cheaper (self-hosted or open-source)
Data Privacy	Data goes to OpenAI servers	Can be self-hosted; data stays in your infra
Customization	Limited (fine-tuning is paid)	Highly customizable (if you own/host Llama)
Accuracy	GPT-4 is state-of-the-art	Llama-2/3 are competitive, sometimes close, but may lag in some tasks depending on version and tuning
Ecosystem	Very mature, easy to use	Growing—lots of open-source, but may require more ML ops setup
Latency	Fast, managed by OpenAI	Can be faster/cheaper if hosted locally, but needs hardware/expertise
How does it apply to ORDERFLOW?

Both OpenAI and Trucube (Llama) can process conversations and detect orders.
With Trucube, you may have more control, lower costs, and can customize the model.
With OpenAI, you get top performance and reliability, but less control/flexibility and higher cost.
3. Should I use Trucube or OpenAI?
Use OpenAI for:

The highest accuracy out-of-the-box.
Less ML ops work.
When you don’t mind data going to their cloud.
Use Trucube/Llama for:

Lower cost (especially for lots of usage).
Customization for your domain (fine-tune on your restaurant data).
Data privacy/ownership (keep customer data internal).
More control over features, upgrades, and model behavior.
4. What next?
If you want to know who provides Trucube, you’ll need to:

Ask your team/project lead.
Look in your repo’s codebase for references (“trucube”, “llama”, API keys, endpoints).
Check your deployment/config credentials.
Summary Table
Option	What is it?	Model Used	How accessed?
OpenAI	Commercial AI service	GPT-3/4	API (openai.com)
Trucube	Your organization’s Llama-wrapper	Llama (Meta)	API/internal service
TL;DR:
Trucube is a Llama-powered alternative to OpenAI in your ORDERFLOW project. It was chosen (or provided) for cost, control, or privacy reasons. It is not a model itself, but a service or API using the Llama models. How it compares: Llama is open-source and customizable, OpenAI is more accurate and plug-and-play.

If you’d like, I can search your repo for “trucube” references and show you exactly how it’s integrated! Would you like that?

You said: is it also a client side library??
is it also a client side library??
Copilot said: Based on your README and typical AI
Based on your README and typical AI architecture (and unless your project documentation says otherwise), Trucube is almost certainly a server-side API/service, not a client-side library.

Why?
1. How AI is Used in ORDERFLOW
The AI functions are invoked on the backend (Node.js/Express TypeScript app).
AI tasks (order detection, response generation, etc.) happen on the server, not in the browser.
2. Client Side (Frontend)
Your frontend is a React/TypeScript app.
The frontend displays live updates, responses, and order information.
It does not process conversations with AI locally—it relies on the backend to handle those via APIs.
3. Usual AI Integration Model
Most LLMs (Llama/OpenAI/etc.) are too large to run in browsers or on user devices. They run on servers and are called via HTTP APIs.
Trucube, as described, is set via environment variable (MODEL=TRUCUBE) in the backend config. There’s no sign of a client-side version or library in your README.
4. Code Clues
AI logic is in files like aiFunctions.ts and is part of backend services.
No mention of a Trucube client-side SDK or JavaScript module is present in your project structure or setup.
In Summary:
Trucube is a server-side API, not a client-side library.
The backend calls Trucube (or OpenAI) to process conversations, detect orders, suggest responses, etc.
The frontend just displays what the server sends.
If you want, I can search your repo for any signs of a client-side Trucube integration or reference, just to be 100% sure. Would you like me to do that?

You said: ye
ye
14 references
Copilot said: **Short answer:** No, Trucube is not
Short answer:
No, Trucube is not a client-side library—it's a backend/server-side API.

How do we know?
1. All Trucube-related calls in your repo are in server-side Node.js TypeScript files:

Example functions like TrucubeConditionalOutput and TrucubePickupTime are defined in server/utils.ts and invoked from server/aiFunctions.ts.
They use fetch to call a backend API (http://98.15.217.173:3000/api/chat/completions).
They require a secret token from environment variables (TRUCUBE_BEARER_TOKEN).
All the logic for choosing Trucube vs OpenAI is based on process.env.MODEL (an environment variable set on the server).
No code references, imports, or usage on the frontend side (client/ directory).
2. The README and other docs only mention Trucube as an AI model provider and backend config option, NOT a frontend dependency.

You set MODEL=TRUCUBE in your environment config (not in frontend package config).
All AI features (order detection, pickup time detection, response generation) are described as backend functions.
3. Why isn't it client-side?

Models like Llama (and OpenAI GPT) are extremely large and cannot run inside a browser or frontend application; they must run on dedicated servers/GPUs.
The frontend (React) only fetches results from the server; all AI processing happens server-side.
Code Examples
See for yourself here (these are all backend/server files):

server/utils.ts – TrucubeConditionalOutput function
server/aiFunctions.ts – Model selection logic (process.env.MODEL)
README: Architecture/backend section
If you want to see every instance of Trucube code, you can browse more results on GitHub.
(Because code search only returns a limited number.)

TL;DR
Trucube is a server-side API wrapper for Llama models in your ORDERFLOW app.
It is not available or used as a JavaScript library on the frontend.

If you want a deeper technical walk-through of exactly how the backend calls Trucube, let me know!

You said: is it a library on the backend??
is it a library on the backend??
Copilot said: **No, Trucube is not a library** (like
No, Trucube is not a library (like an npm package) on your backend.
It is a remote API service that your backend code interacts with over HTTP.

Evidence from Your Codebase
1. API Call Pattern
Your backend code (server/utils.ts, etc.) uses fetch to send HTTP POST requests to:
Code
http://98.15.217.173:3000/api/chat/completions
Example function signature:
TypeScript
export async function TrucubeConditionalOutput(
    systemPrompt: string,
    conversationText: string,
    customerName?: string
) { ... }
This is how you call an external API—not import a local library.
2. No Import/Require Statements
There are no import trucube from ... or require('trucube') statements in your code.
The backend doesn't install Trucube as an npm dependency—just calls its API via HTTP.
3. Secret Management
You use an environment variable (TRUCUBE_BEARER_TOKEN) to provide authorization for API calls, just like you would to interact with a remote service.
Again, this is standard for external APIs, not local libraries.
4. How model selection works
All your backend logic chooses between OpenAI SDK (a library) and Trucube (an API):
TypeScript
const getConditionalOutput = process.env.MODEL === "TRUCUBE"
    ? TrucubeConditionalOutput // calls remote API
    : OpenAIConditionalOutput  // uses OpenAI SDK library
OpenAI is accessed by a Node.js library (openai), Trucube by a remote API endpoint.
Summary Table
Model	Access Method	Type	Example Use
OpenAI	openai npm package	Library	import { OpenAI } from "openai"
Trucube	HTTP API (fetch)	Remote API	fetch("http://...")
TL;DR
Trucube is not a library on your backend.
It is a remote API service (your backend sends HTTP requests to Trucube’s endpoint for AI completion).
Your backend code does not import Trucube—it calls it via fetch like any web service.
If you want more details about the structure of those API calls or want to see integration code in context, just ask!