# GEMINI.MD: AI Collaboration Guide

This document provides essential context for AI models interacting with this project. Adhering to these guidelines will ensure consistency and maintain code quality.

## 1. Project Overview & Purpose

* **Primary Goal:** This project is a Python-based backend agent for a restaurant order management system. It uses a simplified "Agent Development Kit" (ADK) structure to process customer conversations, detect orders using Google's Gemini models, and suggest responses for restaurant managers.
* **Business Domain:** Food Service / Restaurant Technology (AI Order Taking & Assistance).

## 2. Core Technologies & Stack

* **Languages:** Python 3 (Requirements imply Python 3.8+).
* **Frameworks & Runtimes:** 
    * **Custom ADK:** A simplified Agent Development Kit implementation (`adk/core.py`).
    * **Google GenAI SDK:** Uses the `google-genai` library (v1.59.0+) for direct interaction with Vertex AI/Gemini.
* **Databases:** In-Memory storage (`self.context.state`) is currently used for session and order state.
* **Key Libraries/Dependencies:**
    * `google-genai`: Primary AI interface.
    * `pydantic`: For data validation and structured output models (`OrderDetails`, `OrderSummaryResult`).
* **Environment:** Requires Google Cloud environment configuration (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`).

## 3. Architectural Patterns

* **Overall Architecture:** **Agent-Loop Pattern**. The application runs a continuous loop (in `main.py` via `Agent.run()`) that listens for input, maintains a conversation history, and invokes specific AI strategies.
* **Directory Structure Philosophy:**
    * `python_agent_google-genai/`: Root of this specific agent implementation.
    * `app/`: Contains the specific business logic and agent implementation.
        * `agent.py`: The `OrderFlowAgent` class that manages state and flow.
        * `strategies.py`: core AI logic, prompts, and calls to `google.genai`.
        * `models.py`: Pydantic data models.
    * `adk/`: Contains the reusable framework code (`core.py`).
    * `main.py`: CLI entry point.

## 4. Coding Conventions & Style Guide

* **Formatting:** Standard Python (PEP 8). Indentation is 4 spaces.
* **Naming Conventions:**
    * `variables`, `functions`: snake_case (e.g., `analyze_order_summary`, `suggest_response`).
    * `classes`: PascalCase (e.g., `OrderFlowAgent`, `OrderSummaryResult`).
* **AI Integration:** 
    * Uses `google.genai.Client`.
    * **Model:** Code currently specifies `gemini-3-flash-preview` (Note: `README.md` may reference older models; code is authoritative).
    * **Prompts:** System prompts are defined inline within `app/strategies.py`. Structured output is enforced via Pydantic models and JSON response mime types.
* **Error Handling:** 
    * `try...catch` blocks wrap external API calls (GenAI) to prevent agent crashes.
    * Returns fallback objects (e.g., `OrderSummaryResult(orderMade=False)`) on failure.

## 5. Key Files & Entrypoints

* **Main Entrypoint(s):** `python_agent_google-genai/main.py`.
    * **Note:** This script attempts to import from `python_agent.app.agent`. Ensure the directory name or `PYTHONPATH` aligns with this import.
* **Configuration:**
    * Environment variables: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.
    * `requirements.txt`: Python dependencies.
* **Verification:** `verify.py` is a standalone script to test the agent's logic with mocked or real interactions.

## 6. Development & Testing Workflow

* **Local Development Environment:**
    1. Create venv: `python3 -m venv venv`.
    2. Activate: `source venv/bin/activate`.
    3. Install: `pip install -r requirements.txt`.
    4. Set Env: `export GOOGLE_CLOUD_PROJECT=your-project-id`.
    5. Run: `python3 python_agent_google-genai/main.py` (Adjusting for path/import issues if necessary).
* **Testing:**
    * Run `python3 python_agent_google-genai/verify.py` to execute a predefined conversation scenario (Greeting -> Order) and verify state updates.
    * Manual testing via CLI interactions in `main.py`.

## 7. Specific Instructions for AI Collaboration

* **Model Usage:** When modifying `strategies.py`, ensure you use the latest available Gemini model compatible with the `google-genai` SDK. The current implementation uses `gemini-3-flash-preview`.
* **Structured Outputs:** Always use Pydantic models (`app/models.py`) to define the expected schema for AI responses, ensuring type safety and validation.
* **Path/Import Caution:** The `main.py` currently assumes the package is named `python_agent`. If you are refactoring or fixing import errors, check `sys.path` modifications in `main.py` first.
* **State Management:** The agent uses an in-memory dictionary `self.context.state`. If adding persistence, implement it within the `Agent` class or a new Service, keeping the interface consistent.
