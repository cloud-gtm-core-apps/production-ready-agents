# Agent Optimizations - Restaurant Order Assistant

## 📂 Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── agent.py              # ServiceManager, Agent configuration
│   ├── agent_executor.py     # ADK AgentExecutor for A2A integration
│   ├── prompt.py             # System prompts and AI logic
│   └── tools.py              # Menu definitions and agent tools
├── eval/
│   └── eval_dataset.json     # Evaluation dataset for agent testing
└── requirements.txt          # Project dependencies
```

## 🚀 Quick Start

### 1. Set Up Environment

```bash
# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Credentials

Set Google Cloud credentials:
* Method A: [User Credentials](https://google.github.io/adk-docs/agents/models/google-gemini/#method-a-user-credentials-for-local-development) (for Local Development)
```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_GENAI_USE_VERTEXAI=TRUE # For Vertex AI
export GOOGLE_CLOUD_LOCATION="us-central1" 
```

* Method B: [Vertex AI Express Mode](https://google.github.io/adk-docs/agents/models/google-gemini/#method-b-vertex-ai-express-mode)
```bash
export GOOGLE_API_KEY="your-api-key"              # For Gemini API
```

### 3. Run the Agent

Run the agent with the ADK web interface:
```bash
adk web
```

Alternatively, run in CLI mode:
```bash
adk run
```

## 🏗️ Architecture

```
ServiceManager (app/agent.py)
  ├─> get_agent() → ADK Agent with ORDER_DETECTION_SYSTEM_PROMPT
  ├─> get_session_service() → InMemorySessionService  
  └─> get_memory_service() → InMemoryMemoryService
Runner (google.adk.runners)
  └─> run_async() → Executes agent via agent_executor pattern
```

## 📝 Key Components

### Agent Configuration (`app/agent.py`)
- Uses standard ADK `Agent` class
- Model: `gemini-3-flash-preview`
- Name: `restaurant_order_agent`
- Instruction: `ORDER_DETECTION_SYSTEM_PROMPT` from `app/prompt.py`
- Tools: `load_memory`, `search_tool`
- Session: `InMemorySessionService` (no database required)

### System Prompts (`app/prompt.py`)
- **`ORDER_DETECTION_SYSTEM_PROMPT`**: Main agent instruction with menu and guidelines

### Tools (`app/tools.py`)
- `search_tool`: Google search capability via AgentTool
- `build_menu_context()`: Helper to inject menu items into system prompt

## 🔧 Recent Updates

### Runtime Errors Fixed
1. ✅ Import errors (duplicate Agent import, missing tools)
2. ✅ Created `tools.py` module
3. ✅ Switched to `InMemorySessionService` (no PostgreSQL needed)
4. ✅ Fixed template variable in `ORDER_DETECTION_SYSTEM_PROMPT`

### Architecture Changes
- Removed custom `OrderFlowAgent` class
- Now uses standard ADK `Agent` with proper configuration
- Integrated `agent_executor.py` for A2A compatibility
- Simplified tools and dependencies

## 📋 Menu

The agent can help with orders from this menu:

**Pizzas:**
- Cheese Pizza: $12.00
- Pepperoni Pizza: $14.00
- Veggie Pizza: $13.00

**Sandwiches:**
- Turkey Sandwich: $10.00
- Ham Sandwich: $10.00
- Lunch Special (1/2 Sandwich + Soup): $12.00

**Drinks:**
- Soda: $2.50
- Water: $1.50

## ✅ Evaluation

Evaluation cases are stored in:
```bash
eval/eval_dataset.json
```

