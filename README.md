# ORDERFLOW: AI-Powered Restaurant Order Management

ORDERFLOW is a comprehensive, AI-driven restaurant order management system designed to automate order detection from customer SMS messages. This repository is a polyglot monorepo containing the production-target dashboard alongside experimental AI agent implementations.

## 🚀 Project Overview

The primary goal of ORDERFLOW is to eliminate manual order entry for restaurant managers. By connecting restaurants with customers via SMS (Twilio), the system uses advanced Large Language Models (LLMs) to automatically parse conversations, extract order details (items, quantities, pickup times), and provide a real-time dashboard for fulfillment.

## 🏗️ Repository Structure

This monorepo is divided into three main sub-projects, each serving a specific role in the ecosystem:

| Project | Language | Purpose | Key Technologies |
| :--- | :--- | :--- | :--- |
| [**nodejs_agent/**](./nodejs_agent) | TypeScript | **Production Dashboard** | React, Express, PostgreSQL (Drizzle), OpenAI SDK |
| [**python_agent_adk/**](./python_agent_adk) | Python | **ADK Experiment** | Google Agent Development Kit (ADK), Starlette, Gemini |
| [**python_agent_google-genai/**](./python_agent_google-genai) | Python | **Native GenAI Experiment** | Google GenAI SDK, Vertex AI, Pydantic |

### Supporting Directories
- **`conductor/`**: Single source of truth for Product Definitions, Tech Stack guidelines, and architectural Tracks.
- **`shared/`**: Common TypeScript schemas and Zod types shared between the Node.js frontend and backend.
- **`summary_of_optimizations_plans/`**: Documentation regarding cross-project AI optimization strategies (Determinism, Latency, Cost).

## 🛠️ Tech Stack

### Core Application (`nodejs_agent`)
- **Frontend**: React (Vite), Tailwind CSS, Radix UI (iMessage-style UI).
- **Backend**: Node.js (Express), PostgreSQL with Drizzle ORM.
- **Real-time**: Server-Sent Events (SSE) for instant dashboard updates.
- **Integrations**: Twilio (SMS), Clover POS (Syncing menu/orders).

### Experimental Agents (`python_agent_*`)
- **Language**: Python 3.12+
- **AI Models**: Gemini 3.0 Flash/Pro (Vertex AI).
- **Standards**: A2A (Agent-to-Agent) communication protocol.
- **Validation**: Strict Pydantic models for structured data extraction.

## 🔧 Getting Started

Because this is a monorepo, you must treat each sub-project as its own root.

### Prerequisites
- Node.js 18+ & npm
- Python 3.12+
- PostgreSQL database
- Google Cloud Project (for Gemini/Vertex AI)
- OpenAI API Key (for the production dashboard)

### Development Workflow
1.  **Production Dashboard**:
    ```bash
    cd nodejs_agent
    npm install
    npm run dev
    ```
2.  **ADK Python Agent**:
    ```bash
    cd python_agent_adk
    python3 -m venv venv && source venv/bin/activate
    pip install -r requirements.txt
    python3 main.py
    ```
3.  **GenAI Python Agent**:
    ```bash
    cd python_agent_google-genai
    python3 -m venv venv && source venv/bin/activate
    pip install -r requirements.txt
    python3 main.py
    ```

## 📈 AI Optimization Philosophy

A major focus of this repository is **Agent Optimization**. We are actively migrating from "AI Formatting" (asking LLMs to generate text) to "Application Code Extraction" (using LLMs to extract raw JSON data validated by Zod/Pydantic schemas). This ensures:
- **100% Determinism**: String formatting is handled by Python/TypeScript code.
- **Accuracy**: Reduced hallucinations (e.g., the "half sandwich" rejection rule).
- **Efficiency**: Context caching and sliding windows to reduce token costs.

## 📄 Documentation

For detailed information on specific components, refer to:
- [Product Definition](./conductor/product.md)
- [Design Guidelines](./nodejs_agent/design_guidelines.md)
- [Optimization Condensed Plan](./nodejs_agent/summary_of_optimizations_plans/ai-summary-optimizations-condensed.md)

## Evaluation
Run evaluation
Execute the adk eval command. Note the inclusion of export PYTHONPATH=..
```bash
source venv/bin/activate
adk eval app/ eval/eval_dataset.json
```
