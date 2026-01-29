# Implementation Plan - Interactive Agent Confidence & Retry Logic

## 1. 🔍 Analysis & Context
*   **Objective:** Enable the interactive `restaurant_order_agent` (defined in `app/agent.py`) to assess order confidence ('low', 'medium', 'high') and "try again" (ask for clarification or re-evaluate) if confidence is low. This is enforced by updating the `record_order` tool to require a high confidence score.
*   **Affected Files:**
    *   `app/tools.py`: Update `record_order` signature and logic. Update `calculate_order_total` to support confidence assessment.
    *   `app/strategies.py`: Update `ORDER_DETECTION_SYSTEM_PROMPT` to instruct the agent on confidence scoring rules.
    *   `app/agent.py`: (Context only) The `Agent` definition uses these components.
*   **Key Dependencies:** `google.adk`.
*   **Risks/Unknowns:**
    *   Agent might "fake" high confidence to bypass the tool restriction. (Mitigation: Robust Prompting).
    *   Agent might get stuck in a loop if it can't resolve the issue. (Mitigation: Prompt instruction to ask user for help).

## 2. 📋 Checklist
- [ ] Step 1: Update `calculate_order_total` in `app/tools.py` to provide explicit validation details.
- [ ] Step 2: Update `record_order` in `app/tools.py` to accept `confidence_score` and enforce "High" confidence.
- [ ] Step 3: Update `ORDER_DETECTION_SYSTEM_PROMPT` in `app/strategies.py` with Confidence Guidelines.
- [ ] Verification: Test with `verify.py` using ambiguous orders.

## 3. 📝 Step-by-Step Implementation Details

### Step 1: Enhance `calculate_order_total` in `app/tools.py`
*   **Goal:** Provide the Agent with clear signals to determine if confidence should be Low (e.g., missing items).
*   **Action:**
    *   Review `calculate_order_total`.
    *   Ensure it explicitly lists "Invalid Items" or "Ambiguous Items".
    *   (Current implementation already does this partially, explicitly ensure the output format is: `Total: $X.XX. WARNING: Items not found: [A, B]`).

### Step 2: Update `record_order` in `app/tools.py`
*   **Goal:** Enforce the "Retry" logic by rejecting orders with low confidence.
*   **Action:**
    *   Update signature: `def record_order(items: list[str], customer_name: str, confidence_score: str, notes: str = "") -> str:`
    *   Update logic:
        ```python
        confidence_score = confidence_score.lower()
        if confidence_score != "high":
            return f"Order NOT recorded. Confidence is '{confidence_score}'. Please check the menu for valid items, verify quantities, and ask the customer to clarify if needed. Then try again."
        # ... proceed with recording ...
        ```
    *   Update docstring to explain `confidence_score`.

### Step 3: Update Prompt in `app/strategies.py`
*   **Goal:** Teach the Agent how to calculate confidence and use the updated tool.
*   **Action:**
    *   Modify `ORDER_DETECTION_SYSTEM_PROMPT`.
    *   Add section **"CONFIDENCE SCORING"**:
        *   **High:** All items match menu exactly, quantities are clear, customer intent is unambiguous.
        *   **Medium:** Minor spelling errors (resolved by fuzzy match), implied quantities.
        *   **Low:** Items not on menu, unknown quantities, ambiguous request.
    *   Add instruction: "Before recording, call `calculate_order_total`. If it returns warnings about missing items, your confidence is LOW."
    *   Add instruction: "When calling `record_order`, you MUST provide the `confidence_score`. If it is not 'high', the system will reject it."

## 4. 🧪 Testing Strategy
*   **Manual Verification (`verify.py` or interactive):**
    *   **Scenario 1 (Low Confidence):** User: "I want a burger" (Burger not on menu).
        *   Agent calls `calculate_order_total` -> "Burger not found".
        *   Agent attempts `record_order` with `confidence='low'` (or asks clarification directly).
        *   If Agent calls tool with 'low', Tool returns "Retry".
        *   Agent asks user: "We don't have burgers. Check the menu?"
    *   **Scenario 2 (High Confidence):** User: "I want a Cheese Pizza".
        *   Agent calls `calculate_order_total` -> "Total $12.00".
        *   Agent calls `record_order(..., confidence='high')` -> Success.

## 5. ✅ Success Criteria
*   `record_order` tool accepts and checks `confidence_score`.
*   Agent correctly identifies invalid items as "Low" confidence.
*   Agent retries (interacts) instead of hallucinating a completed order when confidence is low.