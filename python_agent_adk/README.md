# Python ADK Agent Walkthrough

I have successfully ported the `python_agent_google-genai` to `python_agent_adk` using the `google-adk` library pattern.

## 📂 Implementation Details

The new agent is located in `python_agent_adk/`:
-   **`app/agent.py`**: The `OrderFlowAgent` class.
    -   Inherits from `adk.Agent` (wrapper/mock provided).
    -   Implements `process_message` to handle the conversation loop.
    -   Maintains state in `self.state`.
-   **`app/strategies.py`**: Ported AI logic using `google-genai` SDK.
    -   Updated to use `gemini-3-flash-preview`.
-   **`main.py`**: Entry point to run the agent interactively.
-   **`verify.py`**: Verification script to test greeting and order detection.

## 🚀 How to Run

1.  **Install Prerequisites**:
    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the Agent**:
    ```bash
    export GOOGLE_CLOUD_PROJECT=genai-apps-25
    export GOOGLE_CLOUD_LOCATION=global
    python3 main.py
    ```

3.  **Verify**:
    ```bash
    python3 verify.py
    ```

## ✅ Verification
The `verify.py` script sends a greeting and a pizza order to the agent.
-   **Greeting**: Checks if agent responds.
-   **Order**: Checks if agent detects "Cheese Pizza".
