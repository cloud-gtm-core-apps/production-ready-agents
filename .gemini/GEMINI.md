# GEMINI.MD: AI Collaboration Guide

This document provides essential context for AI models interacting with this repository. Adhering to these guidelines will ensure consistency across the multiple distinct sub-projects contained within.

## 1. Project Overview & Purpose

*   **Primary Goal:** **ORDERFLOW** is an AI-powered restaurant order management system. This repository serves as a **monorepo** containing the core full-stack application alongside experimental and optimized AI agent implementations.
*   **Focus Area:** The current primary objective is **Agent Optimization**—specifically improving accuracy, reducing latency, ensuring determinism, and managing costs for AI-driven order detection from SMS messages.
*   **Business Domain:** Restaurant Technology / Food Service (Order Management System).

## 2. Core Technologies & Stack

This repository is **Polyglot**, encompassing distinct technology stacks for different components.

*   **Core Application (`nodejs_agent/`):**
    *   **Language:** TypeScript (Node.js v18+).
    *   **Frontend:** React (Vite), Tailwind CSS, Radix UI.
    *   **Backend:** Express.js.
    *   **Database:** PostgreSQL (with Drizzle ORM).
    *   **AI:** OpenAI SDK (OpenAI & Trucube models).

*   **Experimental Agents (`python_agent_*/`):**
    *   **Language:** Python 3.8+.
    *   **Frameworks:** Google Agent Development Kit (ADK), Starlette, Google GenAI SDK.
    *   **AI:** Vertex AI / Gemini Models.

*   **Documentation (`conductor/`):**
    *   Product definitions and tech stack guidelines in Markdown.

## 3. Architectural Patterns

*   **Overall Architecture:** **Multi-Project Repository (Monorepo)** style.
    *   The repository is divided into isolated sub-projects, each with its own dependencies and runtime environment.
    *   **Conductor:** Acts as the single source of truth for Product (`product.md`) and Architectural (`tech-stack.md`) definitions.
*   **Directory Structure Philosophy:**
    *   `/nodejs_agent`: The primary production-target web application and dashboard.
    *   `/python_agent_adk`: Python-based agent implementation using the Google Agent Development Kit.
    *   `/python_agent_google-genai`: Python-based agent implementation using the native Google GenAI SDK.
    *   `/conductor`: High-level project documentation, product specs, and global plans.
    *   `/shared`: TypeScript schemas shared primarily within the Node.js ecosystem (frontend/backend).
    *   `/summary_of_optimizations_plans`: Documentation regarding AI optimization strategies.

## 4. Coding Conventions & Style Guide

**CRITICAL:** Conventions vary by sub-directory. **Always refer to the `GEMINI.md` located within the specific sub-directory you are working in.**

*   **Global Principles:**
    *   **Strict Separation:** Do not mix dependencies. (e.g., Do not import Python files into the Node.js project or vice versa unless implementing a specific inter-process communication bridge).
    *   **Documentation First:** Changes to business logic should align with the definitions in `/conductor`.

*   **TypeScript (`nodejs_agent`):**
    *   **Style:** `camelCase` for vars/functions, `PascalCase` for components.
    *   **Type Safety:** Strict Zod validation. Use shared schemas in `shared/schema.ts`.

*   **Python (`python_agent_*`):**
    *   **Style:** PEP 8. `snake_case` for vars/functions, `PascalCase` for classes.
    *   **Typing:** Use Pydantic models for structured data and configuration.

## 5. Key Files & Entrypoints

*   **Product Definition:** `conductor/product.md` (Read this to understand the "Why" and "What").
*   **Node.js App:**
    *   Server: `nodejs_agent/server/index.ts`
    *   Client: `nodejs_agent/client/src/main.tsx`
*   **Python ADK Agent:** `python_agent_adk/main.py`
*   **Python GenAI Agent:** `python_agent_google-genai/main.py`
*   **Shared Schema:** `shared/schema.ts` (Defines the data model for the TypeScript stack).

## 6. Development & Testing Workflow

*   **Context Switching:** You must treat each top-level directory (e.g., `nodejs_agent`, `python_agent_adk`) as a separate project root when running commands.
    *   *Example:* To run the node app, you must first `cd nodejs_agent` or run `npm start --prefix nodejs_agent`.
*   **Local Development:**
    *   **Node.js:** `npm install` -> `npm run dev`.
    *   **Python:** `python -m venv venv` -> `source venv/bin/activate` -> `pip install -r requirements.txt`.
*   **Testing:**
    *   **Node.js:** Check `package.json` for test scripts (often `npm test`).
    *   **Python:** Look for `verify.py` scripts in the agent directories for end-to-end verification.

## 7. Specific Instructions for AI Collaboration

*   **Sub-Project Awareness:** Before answering questions or generating code, identify which "Agent" or "Application" the user is referring to.
    *   If the user asks about "The Dashboard," they mean `nodejs_agent`.
    *   If they ask about "The ADK Agent," they mean `python_agent_adk`.
*   **Schema Consistency:** If you modify `shared/schema.ts`, you **MUST** update the `nodejs_agent` (DB migrations and Zod types) to reflect these changes.
*   **Environment Variables:** Never infer API keys. Expect them to be present in the environment (`.env`).
*   **Optimization Plans:** When asked to implement optimizations, refer to the documents in `summary_of_optimizations_plans/` and `nodejs_agent/plans/` for agreed-upon strategies.
