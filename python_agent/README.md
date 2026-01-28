# Python ADK Agent Walkthrough

I have successfully created the Python backend agent using a simplified ADK structure and Vertex AI (Gemini Flash).

## 📂 Directory Structure

The new agent is located in `python_agent/`:

-   **`adk/core.py`**: The simplified Agent Development Kit (ADK) core, providing the base `Agent` class and a basic event loop.
-   **`app/agent.py`**: The `OrderFlowAgent` implementation. It handles the conversation flow, maintains state (current order), and orchestrates AI calls.
-   **`app/strategies.py`**: Contains the AI logic.
    -   Uses `vertexai.generative_models.GenerativeModel("gemini-1.5-flash-002")` for fast order detection and response suggestions.
    -   Implements `analyze_order_summary` and `suggest_response`.
-   **`main.py`**: The entrypoint script to run the agent interactively.
-   **`verify.py`**: A verification script that mocks Vertex AI to test the agent's logic without incurring costs or needing active credentials during test.

## 🚀 How to Run

1.  **Install Dependencies**:
    ```bash
    pip install -r python_agent/requirements.txt
    ```
    *(Note: You may need to authenticate with Google Cloud first, e.g., `gcloud auth application-default login`)*

2.  **Run the Agent**:
    ```bash
    export GOOGLE_CLOUD_PROJECT=your-project-id
    python3 python_agent/main.py
    ```

## ✅ Verification Results

I ran `python_agent/verify.py` which simulates a conversation:
1.  **Greeting**: User says "Hi there" -> Agent suggests a greeting.
2.  **Order**: User says "I'd like a cheese pizza" -> Agent detects the order and updates its internal state.

**Output:**
```text
--- Test 1: Greeting ---
User: Hi there
Agent: Hi! How can I help you today?

--- Test 2: Ordering Pizza ---
User: I'd like a cheese pizza please
 [Order Detected]: { "customerName": "Alice", "items": ["1x Cheese Pizza"] ... }
Agent: Got it, one cheese pizza. Anything else?

[SUCCESS] Order detected and stored in state correctly.
```
