# Python Agent Optimization Plan

This document outlines strategies to improve the accuracy, determinism, and performance of the Python `ORDERFLOW` agent, mirroring the optimizations identified for the Node.js agent but adapted for the Python ecosystem (Pydantic, Google GenAI SDK).

## 🟢 LOW EFFORT (Quick Wins)

### 1. **Structured Outputs with Pydantic & GenAI SDK**
**Problem:** Currently, the agent relies on prompt engineering ("Return only valid JSON") and manual `json.loads` to exact data. This is fragile and prone to parsing errors.
**Solution:** Use the native structured output capabilities of the Google GenAI SDK (`response_schema`) combined with Pydantic models.

**Implementation:**
```python
from google.genai import types

# Define schema directly from Pydantic
config = types.GenerateContentConfig(
    response_mime_type="application/json",
    response_schema=OrderSummaryResult, # Pass Pydantic class directly
    temperature=0
)

# No need for manual json parsing or prompt instructions about JSON format
# The SDK handles serialization/deserialization
response = client.models.generate_content(..., config=config)
result = response.parsed  # This would need to be adapted to how the SDK specifically returns parsed objects or if we need to parse manually using model.validate_json(response.text)
```

### 2. **Confidence Scoring**
**Problem:** The AI always returns an answer even if ambiguous.
**Solution:** Add a confidence field to the Pydantic model.

**model.py:**
```python
from enum import Enum

class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class OrderSummaryResult(BaseModel):
    # ...
    confidence: ConfidenceLevel
    reasoning: str # Chain-of-thought
```

### 3. **Business Logic Validators (Pydantic Validators)**
**Problem:** AI might halluciation items or prices.
**Solution:** Use Pydantic's `@field_validator` to enforce rules.

**models.py:**
```python
from pydantic import field_validator

class OrderDetails(BaseModel):
    items: List[str]
    
    @field_validator('items')
    def validate_items(cls, v):
        # Check against known menu items
        valid_items = [...] # Load from menu source
        for item in v:
             if item not in valid_items:
                 raise ValueError(f"Invalid menu item: {item}")
        return v
```

### 4. **Pin Model Versions**
**Problem:** Using `gemini-3-flash-preview` might be unstable or change behavior.
**Solution:** Pin to a specific stable version if available, or allow configuration via env vars.

### 5. **Negative Prompting & Role Prompting**
**Problem:** "Half sandwich" hallucinations.
**Solution:** Enhance the system prompt with explicit constraints and persona.

**Prompt Update:**
```text
Role: You are an expert restaurant order taker.
Constraint: DO NOT hallucinate items. 
Constraint: If the user asks for a 'half sandwich', politely decline in the 'suggestedResponse' and set orderMade=False.
```

### 6. **Chain-of-Thought (CoT)**
**Problem:** Hard to debug why an order was detected (or not).
**Solution:** Add a `reasoning` string field to the output model.

## 🟡 MEDIUM EFFORT

### 7. **Conversation Compression**
**Problem:** Sending entire history wastes tokens.
**Solution:** Filter out pure greetings or unrelated chit-chat before sending to the model.

### 8. **Semantic Caching (LRU / Simple)**
**Problem:** Repetitive inputs cost money/latency.
**Solution:** Implement a simple in-memory LRU cache or file-based cache for identical inputs.
```python
from functools import lru_cache

@lru_cache(maxsize=100)
def analyze_cached(conversation_hash):
    # ...
```

### 9. **Retry Logic with Backoff**
**Problem:** Network glitches or rare model errors.
**Solution:** Use a library like `tenacity` for robust retries.

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
def generate_safe():
   # ...
```

## 🔴 HIGH EFFORT

### 10. **Few-Shot Prompting (Dynamic)**
**Problem:** Complex edge cases need examples.
**Solution:** Dynamically inject 3-5 relevant examples of conversations and expected JSON outputs into the prompt.

### 11. **Evaluation Framework (CI/CD)**
**Problem:** Unsure if changes improve or degrade quality.
**Solution:** Create a `verify.py` script that runs against a golden dataset of conversations and asserts the extracted orders match expectations.
