# GEMINI.MD: AI Collaboration Guide

This document provides essential context for AI models interacting with this project. Adhering to these guidelines will ensure consistency and maintain code quality.

## 1. Project Overview & Purpose

* **Primary Goal:** This project is a Python-based Restaurant Order Assistant agent built using the Google Agent Development Kit (ADK). It is designed to interpret natural language user inputs to detect orders, manage menus, and suggest responses.
* **Business Domain:** Food Service / Restaurant Technology (AI Order Taking).

## 2. Core Technologies & Stack

* **Languages:** Python 3 (Specific version inferred: 3.8+ based on type hinting and `venv` usage).
* **Frameworks & Runtimes:** 
    * **Google ADK (Agent Development Kit):** Core framework for building the agent.
    * **A2A SDK:** Agent-to-Agent communication standard.
    * **Starlette:** Used via A2A SDK for serving the agent (implied by `A2AStarletteApplication`).
* **Databases:**
    * **Primary:** In-Memory storage (`InMemorySessionService`, `InMemoryMemoryService`) for current configuration.
    * **Future/Optional:** PostgreSQL (supported by `DatabaseSessionService`, referenced in code comments).
* **Key Libraries/Dependencies:**
    * `google-adk`: Main agent framework.
    * `a2a-sdk`: For agent interoperability.
    * `litellm`: For model abstraction and interface.
    * `pydantic`: For data validation and settings management.
* **Package Manager(s):** `pip` (dependency management via `requirements.txt`).

## 3. Architectural Patterns

* **Overall Architecture:** **Agent-Executor Pattern** with a **Service Manager**.
    * The system uses a `ServiceManager` class (`app/agent.py`) to lazy-load and manage singleton instances of services (Session, Memory, Agent).
    * It implements the Google ADK `Runner` pattern for executing the agent loop.
* **Directory Structure Philosophy:**
    * `/app`: Contains the core application logic.
        * `agent.py`: Configuration and initialization of the Agent and Services.
        * `prompt.py`: Contains system prompts (`ORDER_DETECTION_SYSTEM_PROMPT`) and core business logic functions.
        * `tools.py`: Definitions of tools available to the agent (e.g., date, search).
        * `agent_executor.py`: Adapts the ADK agent for A2A execution.
    * `/plan`: Contains documentation and optimization plans.
    * Root (`/`): Contains entry points and verification scripts.

## 4. Coding Conventions & Style Guide

* **Formatting:** Python standard (PEP 8 inferred). Indentation is 4 spaces.
* **Naming Conventions:**
    * `variables`, `functions`: snake_case (e.g., `get_agent`, `analyze_order_summary`).
    * `classes`: PascalCase (e.g., `ServiceManager`, `InMemorySessionService`).
    * `constants`: UPPER_CASE (e.g., `ORDER_DETECTION_SYSTEM_PROMPT`, `AGENT_PORT`).
* **API Design:** 
    * The agent exposes an A2A (Agent-to-Agent) compatible interface.
    * Supports JSON-RPC via Starlette (when running as a server).
* **Error Handling:**
    * `try...catch` blocks used in the main run loop (`main.py`) to handle `KeyboardInterrupt` and general exceptions.
    * Tracebacks are printed for debugging.

## 5. Key Files & Entrypoints

* **Main Entrypoint(s):** 
    * `main.py`: CLI entry point for running the agent locally.
    * `app/agent.py`: Core configuration file for initializing the agent and its services.
* **Configuration:**
    * Environment variables are the primary configuration method (e.g., `GOOGLE_CLOUD_PROJECT`, `GOOGLE_API_KEY`, `AGENT_MODE`).
    * `requirements.txt`: Python dependency definitions.
* **Verification:**
    * `verify.py`: A script to run automated verification tests against the agent (e.g., testing greeting and order flows).

## 6. Development & Testing Workflow

* **Local Development Environment:**
    1. Create a virtual environment: `python3 -m venv venv`.
    2. Activate it: `source venv/bin/activate`.
    3. Install dependencies: `pip install -r requirements.txt`.
    4. Set required environment variables (Google Cloud Project, API Key).
    5. Run the agent: `python main.py`.
* **Testing:**
    * Run verification tests using `python verify.py`.
    * Manual testing via the CLI interface in `main.py`.
* **CI/CD Process:** Not explicitly defined in this directory. Relies on manual verification and potentially parent repository workflows.

## 7. Specific Instructions for AI Collaboration

* **Prompt Engineering:** modifications to the agent's behavior should primarily happen in `app/strategies.py` by updating `ORDER_DETECTION_SYSTEM_PROMPT` or `RESPONSE_SUGGESTION_SYSTEM_PROMPT`.
* **Tool Definition:** New tools should be defined in `app/tools.py` and registered in the `Agent` configuration in `app/agent.py`.
* **State Management:** The project currently defaults to `InMemorySessionService`. When discussing persistence, be aware that `DatabaseSessionService` is available but not currently active in the default `ServiceManager` configuration.
* **Environment:** Always remind the user to set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_API_KEY` (or `GOOGLE_CLOUD_LOCATION` for Vertex AI) if they encounter authentication errors.
