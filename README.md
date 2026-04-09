# Agent Optimizations - Restaurant Order Assistant

This project is a **Restaurant Order Assistant** built using the **Agent Development Kit (ADK)**. It helps customers find menu items, place orders, and check status using Gemini.

## 📂 Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── agent.py              # ServiceManager, Agent configuration
│   ├── agent_executor.py     # Simplified ADK Runner (Main Entry point)
│   ├── prompt.py             # System prompts and AI logic
│   └── tools.py              # Menu definitions and agent tools
├── eval/
│   └── eval_dataset.json     # Evaluation dataset for agent testing
└── requirements.txt          # Project dependencies
```

## 🚀 Quick Start

### 1. Set Up Environment

First, create and activate a virtual environment:
```bash
# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Credentials

Set your Google Cloud project and enable Vertex AI:
```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_GENAI_USE_VERTEXAI=TRUE
export GOOGLE_CLOUD_LOCATION="us-central1" 
```

### 3. Run the Agent

You can run the agent in several ways:

**A. Interactive CLI Mode (Best for Testing)**
Start a live, real-time chat with the agent directly in your terminal:
```bash
python3 -m app.agent_executor
```
*(Supports tool-calling visibility and graceful exit with `Ctrl+C`)*

**B. ADK Web Interface**
Launch a rich, graphical chat UI:
```bash
adk web
```

**C. ADK CLI**
Run a one-off command session:
```bash
adk run
```

## 🏗️ Architecture

- **`app/agent.py`**: Centralizes the `Agent` definition and services (Session, Memory, Artifacts).
- **`app/agent_executor.py`**: A streamlined implementation of the `Runner` that handles conversation state and execution without framework overhead.
- **`app/prompt.py`**: Defines the system persona and business rules.
- **`app/tools.py`**: Contains the menu logic and external search capabilities.

## ✅ Evaluation

Evaluation cases are stored in `eval/eval_dataset.json`. You can run evaluations using:
```bash
adk eval run --input eval/eval_dataset.json
```
