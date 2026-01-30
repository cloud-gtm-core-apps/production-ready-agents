# Technology Stack

This project is a Python-based AI agent implementation using the Google Agent Development Kit (ADK) and the A2A SDK.

## Core Stack
- **Language:** Python 3.12+
- **Agent Framework:** Google ADK (Agent Development Kit)
- **Communication Protocol:** A2A SDK (Agent-to-Agent)
- **Model Interface:** LiteLLM (for multi-model support including Gemini, Vertex AI, and GKE endpoints)

## Backend & Services
- **Runtime:** Starlette (via A2AStarletteApplication)
- **Environment Management:** Python venv
- **Data Validation:** Pydantic
- **Logging:** Python standard logging

## Persistence & State Management
- **Session Management:** Google ADK Session Service (InMemorySessionService by default, DatabaseSessionService supported)
- **Memory:** Google ADK Memory Service (InMemoryMemoryService)
- **Artifacts:** Google ADK Artifact Service (InMemoryArtifactService)

## Integrations
- **AI Models:** 
  - Gemini (default: gemini-3-flash-preview)
  - Vertex AI (optional)
  - GKE Inference Endpoints (optional)

## Development & Testing
- **CLI Entrypoint:** `main.py`
- **Verification:** `verify.py` for automated flow testing
- **Dependency Management:** pip (`requirements.txt`)