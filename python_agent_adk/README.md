# Python ADK Agent - Restaurant Order Assistant

## 📂 Project Structure

```
python_agent_adk/
├── app/
│   ├── agent.py              # ServiceManager, Agent configuration
│   ├── agent_executor.py     # ADK AgentExecutor for A2A integration
│   ├── strategies.py         # System prompts and AI logic
│   └── tools.py              # Tool definitions (date, search)
├── main.py                   # CLI entry point
├── integration_tests
│   └── verify.py             # Verification script
└── requirements.txt          # Dependencies
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
export GOOGLE_CLOUD_PROJECT="genai-apps-25"
export GOOGLE_GENAI_USE_VERTEXAI=TRUE # For Vertex AI
export GOOGLE_CLOUD_LOCATION="global" 
```

* Method B: [Vertex AI Express Mode](https://google.github.io/adk-docs/agents/models/google-gemini/#method-b-vertex-ai-express-mode)
```bash
export GOOGLE_API_KEY="your-api-key"              # For Gemini API
```

### 3. Run the Agent

```bash
python main.py
```
or run with adk web
```bash
uv run adk web
```
or run with uvicorn for a2a
```bash
#try the ui: http://127.0.0.1:8001/.well-known/agent-card.json
uvicorn app.agent:app --host localhost --port 8001
```

**Expected Output:**
```
Initializing ServiceManager...
ServiceManager initialized (services will be lazy-loaded).
Initializing Restaurant Order Agent (ADK)...
Initializing Root Agent...
Initializing InMemorySessionService...
Initializing InMemoryMemoryService...
Agent started. Type 'quit' to exit.
You: 
```

## 🏗️ Architecture

```
main.py
  └─> ServiceManager (agent.py)
        ├─> get_agent() → ADK Agent with ORDER_DETECTION_SYSTEM_PROMPT
        ├─> get_session_service() → InMemorySessionService  
        └─> get_memory_service() → InMemoryMemoryService
  └─> Runner (google.adk.runners)
        └─> run_async() → Executes agent via agent_executor pattern
```

## 📝 Key Components

### Agent Configuration (`app/agent.py`)
- Uses standard ADK `Agent` class
- Model: `gemini-3-flash-preview`
- Name: `restaurant_order_agent`
- Instruction: `ORDER_DETECTION_SYSTEM_PROMPT` from strategies
- Tools: `load_memory`, `get_current_date`, `search_tool`
- Session: `InMemorySessionService` (no database required)

### System Prompts (`app/strategies.py`)
- **`ORDER_DETECTION_SYSTEM_PROMPT`**: Main agent instruction with menu and guidelines
- **`RESPONSE_SUGGESTION_SYSTEM_PROMPT`**: Response generation guidelines
- Functions: `analyze_order_summary()`, `suggest_response()`

### Tools (`app/tools.py`)
- `get_current_date()`: Returns current date
- `search_tool`: Google search capability via AgentTool

## 🔧 Recent Updates

### Runtime Errors Fixed
1. ✅ Import errors (duplicate Agent import, missing tools)
2. ✅ Created `tools.py` module
3. ✅ Switched to `InMemorySessionService` (no PostgreSQL needed)
4. ✅ Fixed template variable in `ORDER_DETECTION_SYSTEM_PROMPT`
5. ✅ Updated `main.py` to use Runner pattern

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

## ✅ Verification

Run the verification script:
```bash
python integration_tests/verify.py
```

This tests:
- Greeting response
- Order detection for pizza orders

## Evaluation

1. Generate a new Eval Set from a Session:
If you have a session file exported from adk webui (e.g., eval/session-a388f51e-8c56-4732-a93c-e72c545d472a.json), run:
```bash
python generate_evalset_from_session.py eval/session-a388f51e-8c56-4732-a93c-e72c545d472a.json eval
```

Output: eval/session-a388f51e-8c56-4732-a93c-e72c545d472a.evalset.json
2. Run Evaluation:
Execute the adk eval command. Note the inclusion of export PYTHONPATH=..
```bash
source venv/bin/activate
adk eval app/ eval/session-a388f51e-8c56-4732-a93c-e72c545d472a.evalset.json
```

3. Run Existing Sample Eval:
```bash
source venv/bin/activate
adk eval app/ eval/eval_dataset/evalset_intro_menu_pickup.evalset.json
# run with lower thresholds
adk eval app/ eval/eval_dataset/evalset_intro_menu_pickup.evalset.json --config_file_path eval/eval_config.json

# run and store results
adk eval app eval/eval_dataset/evalset_intro_menu_pickup.evalset.json --config_file_path=eval/eval_config_1/eval_config.json --print_detailed_results > eval/eval_config_1/evalset_intro_menu_pickup.eval_results.txt


# run with v2
adk eval app eval/eval_dataset/evalset_intro_menu_pickup.evalset.json --config_file_path=eval/eval_config_2/eval_config.json --print_detailed_results > eval/eval_config_2/evalset_intro_menu_pickup.eval_results.txt
```

This tests:

Greeting response
Order detection for pizza orders

- Order detection for pizza orders
