# Python Agent Optimization Plan (ADK Edition)

This document outlines strategies to improve the accuracy, determinism, and performance of the Python `ORDERFLOW` agent using Google ADK.

## 🟢 LOW EFFORT (Quick Wins)

### 1. **Structured Outputs with ADK & Pydantic**
**Problem:** `strategies.py` currently uses manual `json.loads()`, which is fragile.
**Solution:** Pass the Pydantic model directly to the `response_schema` in `GenerateContentConfig`. ADK models like `Gemini` (and our `VertexGemini` subclass) pass this to the GenAI SDK for native parsing.

**Implementation:**
```python
# In strategies.py
config = types.GenerateContentConfig(
    response_mime_type="application/json",
    response_schema=OrderSummaryResult,
    temperature=0
)
# The SDK handles the parsing; access via response.parsed (if supported) 
# or model.validate_json()
```

### 2. **Confidence Scoring & Reasoning (CoT)**
**Problem:** It's hard to debug why the model made a specific prediction.
**Solution:** Update the `OrderSummaryResult` model to include confidence and reasoning.

```python
class OrderSummaryResult(BaseModel):
    orderMade: bool
    orderDetails: Optional[OrderDetails] = None
    confidence: str # HIGH, MEDIUM, LOW
    reasoning: str  # Thought process
```

### 3. **Business Logic Validators**
**Problem:** The model might invent menu items.
**Solution:** Use Pydantic's `@field_validator` to check items against `build_menu_context()`.

### 4. **Pin Model Versions**
**Problem:** `gemini-3-flash-preview` is an alias that might change.
**Solution:** Pin to a specific stable version (e.g., `gemini-1.5-flash-002`) in `strategies.py`.

---

## 🟡 MEDIUM EFFORT

### 5. **Persistent Session Management**
**Problem:** `InMemorySessionService` is used in `agent.py`, losing context on restart.
**Solution:** Switch to `DatabaseSessionService` or `VertexAiSessionService` for production persistence.

```python
# In agent.py
def _init_session_service(self):
    return DatabaseSessionService(db_url=DB_URL)
```

### 6. **Conversation Compression**
**Problem:** Sending long histories increases latency and costs.
**Solution:** Implement a summary strategy or filter unrelated messages before formatting context in `strategies.py`.

### 7. **Robust Retry Logic**
**Problem:** Transient network or API errors.
**Solution:** Wrap `generate_content_async` calls with `tenacity` retries.

---

## 🔴 HIGH EFFORT

### 8. **Dynamic Few-Shot Prompting**
**Problem:** Complex orders need examples.
**Solution:** Use a vector database (via `VertexAiRagMemoryService` in ADK) to retrieve similar past conversations and inject them as few-shot examples.

### 9. **ADK Evaluation Framework**
**Problem:** Regression testing for agent logic is manual.
**Solution:** Create a custom evaluation script using the ADK `Runner` to process a "golden dataset" and compare JSON outputs automatically.
