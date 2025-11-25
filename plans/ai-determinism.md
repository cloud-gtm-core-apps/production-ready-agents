# Feature Implementation Plan: Improve AI Determinism & Architecture

## 📋 Todo Checklist

### Phase 1: Structured Data & Formatting (Immediate)
- [ ] Create `server/aiSchemas.ts` with Zod schemas for AI outputs.
- [ ] Update `server/utils.ts` to implement Structured Outputs using `zodResponseFormat`.
- [ ] Refactor `OpenAIOrderSummary` to use the new schema and map results to the existing string format.
- [ ] Refactor `OpenAIPickupTime` and `OpenAIHalfSandwich` to use structured schemas.
- [ ] Create strict system prompts optimized for data extraction (removing formatting instructions).
- [ ] Ensure `Trucube` implementations remain compatible or are updated to match the interface.
- [ ] Set model temperature to 0 for all extraction tasks.
- [ ] Verify `server/aiFunctions.ts` integration.

### Phase 2: Architectural Improvements (Future/Advanced)
- [ ] **RAG (Retrieval-Augmented Generation) for Menu Context**:
    - [ ] Implement vector search for menu items instead of injecting the *entire* menu into the prompt.
    - [ ] This improves accuracy for large menus and reduces token costs/latency.
- [ ] **Conversation Session Memory**:
    - [ ] Implement a sliding window or summarization strategy for long conversations.
    - [ ] Ensure the AI "remembers" context (e.g., allergies, previous rejections) without re-reading 50+ messages every time.
- [ ] **Multi-Shot Prompting**:
    - [ ] Add 3-5 high-quality examples of [Conversation -> JSON] pairs in the system prompt.
    - [ ] This "teaches" the model the exact logic for edge cases (like "half sandwich" rejection).
- [ ] **Chain-of-Thought (CoT) Prompting**:
    - [ ] Ask the model to output a `reasoning` field before the `orderDetails` JSON.
    - [ ] Example: `{"reasoning": "Customer asked for half sandwich. Rule says reject. Outputting orderMade: false.", "orderMade": false}`.
    - [ ] This significantly improves accuracy on complex logic tasks.

## 🔍 Analysis & Investigation

### Codebase Structure
- **`server/aiFunctions.ts`**: Orchestrates AI logic, calls helpers in `utils.ts`.
- **`server/utils.ts`**: Contains API calls and prompt generation.
- **`shared/schema.ts`**: Database schemas.

### Current Architecture & Limitations
- **Full-Context Injection**: Currently, the *entire* menu and *entire* conversation history are sent in every request.
    - *Risk*: As menus/conversations grow, we hit context limits or confuse the model with irrelevant info.
- **Zero-Shot Prompting**: We ask the model to perform the task without showing it examples.
    - *Risk*: Models struggle with complex business rules (e.g., "half sandwich logic") without seeing an example of it being applied.
- **Stateless Analysis**: Each request is treated largely in isolation (though we send history, there's no "memory" state).

### Considerations & Challenges
- **Latency**: RAG adds a retrieval step, which *could* add latency, but often *reduces* it by shrinking the prompt size.
- **Cost**: Sending fewer tokens (via RAG/Summarization) saves money.
- **Complexity**: Implementing vector storage (e.g., pgvector) adds infrastructure complexity.

## 📝 Implementation Plan (Phase 1 Focus)

### Prerequisites
- OpenAI SDK `^6.7.0` (Verified).

### Step-by-Step Implementation (Phase 1)

1.  **Step 1: Define Zod Schemas**
    - Create `server/aiSchemas.ts`.
    - Define `OrderExtractionSchema`:
      ```typescript
      z.object({
        reasoning: z.string().describe("Briefly explain your logic before extracting data."), // Added for CoT
        orderMade: z.boolean(),
        customerName: z.string().optional(),
        items: z.array(z.object({
          name: z.string(),
          quantity: z.number(),
          unitPrice: z.number().optional(),
          modifications: z.string().optional()
        })),
        pickupTime: z.string().optional(),
        notes: z.string().optional()
      })
      ```

2.  **Step 2: Update System Prompts (Multi-Shot + CoT)**
    - In `server/utils.ts`, update `buildStructuredSystemPrompt`.
    - **Add Examples**: Include 2-3 short examples of conversations and their expected JSON output (especially for the "half sandwich" rule).
    - **Add Reasoning**: Instruct the model to "Think step-by-step" in the `reasoning` field.

    **Example Training Data (from real Corn On The Corner conversations):**

    ```typescript
    const TRAINING_EXAMPLES = `
    EXAMPLE 1 - Simple Order:
    Customer: "Hey"
    Customer: "1 Nashville grilled chicken spicy\n1 fries\nAzer Khan\n810 pm"
    Restaurant: "Does 8:40 work?"
    Customer: "Ya"

    Expected Output:
    {
      "reasoning": "Customer clearly ordered 1 Nashville grilled chicken spicy and 1 fries. Name is Azer Khan. Initially requested 810 pm but confirmed restaurant's proposal of 8:40 PM.",
      "orderMade": true,
      "customerName": "Azer Khan",
      "items": [
        {"name": "Nashville grilled chicken spicy", "quantity": 1, "unitPrice": 9.99},
        {"name": "Fries", "quantity": 1, "unitPrice": 3.99}
      ],
      "pickupTime": "8:40 PM",
      "notes": "Pickup time negotiated from 8:10 PM to 8:40 PM"
    }

    EXAMPLE 2 - Half Sandwich Edge Case (MUST REJECT):
    Restaurant: "Corn On The Corner, This is our storefront location..."
    Customer: "1/2 Nashville grilled chicken spicy\nAzer Khan\n630 pm"
    Customer: "does it come with fries?"
    Restaurant: "Hey sorry about that we can't do half grilled cheeses!"

    Expected Output:
    {
      "reasoning": "Customer requested '1/2 Nashville grilled chicken spicy' which is NOT on the menu. Restaurant explicitly rejected this request saying 'we can't do half grilled cheeses'. DO NOT create 'half sandwich' items. No valid order exists.",
      "orderMade": false,
      "customerName": "Azer Khan",
      "items": [],
      "pickupTime": null,
      "notes": "Customer request for half sandwich was declined by restaurant"
    }

    EXAMPLE 3 - Order with Modifications:
    Customer: "1 Nashville Chicken\nAzer Khan\n845 pm"
    Restaurant: "Got it does 8:55 work"
    Customer: "does it come w fries?"
    Customer: "and yes works"
    Restaurant: "Yes"
    Restaurant: "Grilled cheese or sliders?"
    Customer: "grilled cheese"
    Customer: "add fries please"
    Restaurant: "No problem"

    Expected Output:
    {
      "reasoning": "Customer initially ordered 1 Nashville Chicken. Through conversation, customer confirmed pickup time 8:55 PM works. Customer then added grilled cheese and fries to the order. All items confirmed by restaurant.",
      "orderMade": true,
      "customerName": "Azer Khan",
      "items": [
        {"name": "Nashville Chicken", "quantity": 1, "unitPrice": 8.99},
        {"name": "Grilled Cheese", "quantity": 1, "unitPrice": 6.99},
        {"name": "Fries", "quantity": 1, "unitPrice": 3.99}
      ],
      "pickupTime": "8:55 PM",
      "notes": "Order built up through conversation - items added incrementally"
    }

    EXAMPLE 4 - Complex Order with Combo Notation:
    Customer: "3 Nashville grilled cheese spicy (2 combo)\n1 cheese steak sandwich\nAzer khan\nasap"
    Restaurant: "Got it does 9:15 work?"
    Customer: "Yes thx"

    Expected Output:
    {
      "reasoning": "Customer ordered 3 Nashville grilled cheese spicy with 2 of them as combos (add $1.99 each), plus 1 cheese steak sandwich. Name: Azer Khan. ASAP converted to restaurant's proposal of 9:15 PM which customer confirmed.",
      "orderMade": true,
      "customerName": "Azer Khan",
      "items": [
        {"name": "Nashville grilled cheese spicy", "quantity": 3, "unitPrice": 6.99},
        {"name": "Combo upgrade", "quantity": 2, "unitPrice": 1.99},
        {"name": "Cheese steak sandwich", "quantity": 1, "unitPrice": 8.99}
      ],
      "pickupTime": "9:15 PM",
      "notes": "2 out of 3 grilled cheese upgraded to combo"
    }

    EXAMPLE 5 - Inquiry (NOT an order):
    Restaurant: "Corn On The Corner, This is our storefront location..."
    Customer: "Wait time on chicken caesar wrap?"
    Restaurant: "An hour currently"

    Expected Output:
    {
      "reasoning": "Customer only asked about wait time for chicken caesar wrap. This is an INQUIRY, not an order. Customer did not confirm or place an order.",
      "orderMade": false,
      "customerName": null,
      "items": [],
      "pickupTime": null,
      "notes": "Customer inquiry about wait time - no order placed"
    }
    `;
    ```

3.  **Step 3: Refactor API Calls**
    - Implement `zodResponseFormat` with the new schema (including `reasoning`).
    - Map the structured output to the legacy format, discarding the `reasoning` field (internal use only).

4.  **Step 4: Refactor `Trucube` Handlers**
    - Update Trucube prompts to request the same JSON structure (including reasoning).
    - Validate with Zod.

### Testing Strategy
- **Manual Verification**: Use `AITestSimulator`.
- **Edge Case Testing**: Specifically test "half sandwich" requests to see if the CoT reasoning correctly identifies the rule.

## 🎯 Success Criteria
- **Accuracy**: Significant reduction in "half sandwich" hallucinations.
- **Predictability**: 100% valid JSON output.
- **Explainability**: We can inspect the `reasoning` field in logs to understand *why* the AI made a decision.

---

## 🧪 Testing with Real Conversation Samples

### Test Case 1: Simple Order (Expected: Success)
**Input:**
```
Customer: "Hey"
Customer: "1 Nashville grilled chicken spicy\n1 fries\nAzer Khan\n810 pm"
Restaurant: "Does 8:40 work?"
Customer: "Ya"
```

**Expected Behavior:**
- ✅ `orderMade: true`
- ✅ `customerName: "Azer Khan"`
- ✅ Items: Nashville chicken + Fries
- ✅ `pickupTime: "8:40 PM"` (updated from 8:10 PM)
- ✅ Reasoning explains time negotiation

### Test Case 2: Half Sandwich Rejection (Expected: orderMade = false)
**Input:**
```
Customer: "1/2 Nashville grilled chicken spicy\nAzer Khan\n630 pm"
Restaurant: "Hey sorry about that we can't do half grilled cheeses!"
```

**Expected Behavior:**
- ✅ `orderMade: false` (CRITICAL - no hallucination)
- ✅ `items: []` (empty, not "half sandwich")
- ✅ Reasoning explains why order was rejected
- ✅ Business validator catches any "half" in items array

**Validation Code:**
```typescript
function validateNoHalfSandwich(result: OrderExtractionResult): boolean {
  // Check items array for "half" keyword
  const hasHalf = result.items.some(item =>
    item.name.toLowerCase().includes('half')
  );

  if (hasHalf) {
    console.error('❌ HALLUCINATION DETECTED: Half sandwich in output', result);
    return false;
  }

  return true;
}
```

### Test Case 3: Order Modifications (Expected: Items accumulated correctly)
**Input:**
```
Customer: "1 Nashville Chicken\nAzer Khan\n845 pm"
Restaurant: "Grilled cheese or sliders?"
Customer: "grilled cheese"
Customer: "add fries please"
```

**Expected Behavior:**
- ✅ `orderMade: true`
- ✅ Items: [Nashville Chicken, Grilled Cheese, Fries]
- ✅ All 3 items present (not just last mentioned)
- ✅ Reasoning shows incremental build-up

### Test Case 4: Complex Combo Order (Expected: Combo notation parsed)
**Input:**
```
Customer: "3 Nashville grilled cheese spicy (2 combo)\n1 cheese steak sandwich\nAzer khan\nasap"
```

**Expected Behavior:**
- ✅ `orderMade: true`
- ✅ Items include: 3x grilled cheese + 2x combo upgrade + 1x cheese steak
- ✅ Combo upgrade calculated separately
- ✅ Reasoning explains "(2 combo)" notation

### Test Case 5: Inquiry Detection (Expected: Not an order)
**Input:**
```
Customer: "Wait time on chicken caesar wrap?"
Restaurant: "An hour currently"
```

**Expected Behavior:**
- ✅ `orderMade: false`
- ✅ `items: []`
- ✅ Reasoning identifies this as inquiry, not order
- ✅ No false positive order detection

---

## 📊 Comparison: Before vs After Optimization

### Before (Current State):
```typescript
// Using basic JSON mode
response_format: { type: 'json_object' }

// Problems:
❌ Inconsistent JSON format
❌ "half sandwich" hallucinations
❌ No reasoning for debugging
❌ Hard to validate outputs
❌ Edge cases fail
```

**Example Failure (Half Sandwich):**
```json
{
  "orderMade": true,  // ❌ WRONG
  "items": ["1x Half Nashville: $4.99"],  // ❌ HALLUCINATION
  "total": 4.99
}
```

### After (With Structured Outputs + Multi-Shot):
```typescript
// Using zodResponseFormat with training examples
response_format: zodResponseFormat(OrderExtractionSchema, 'order')

// Benefits:
✅ 100% valid JSON structure
✅ No "half sandwich" hallucinations
✅ Reasoning field for debugging
✅ Business validators catch errors
✅ Edge cases handled via examples
```

**Example Success (Half Sandwich):**
```json
{
  "reasoning": "Customer requested 1/2 Nashville which is NOT on menu. Restaurant declined. No valid order.",
  "orderMade": false,  // ✅ CORRECT
  "items": [],  // ✅ CORRECT - no hallucination
  "notes": "Half sandwich request declined by restaurant"
}
```

---

## 🔑 Key Patterns From Real Conversations

### Pattern 1: Pickup Time Negotiation
- Customer proposes time → Restaurant counters → Customer confirms
- Example: "810 pm" → "Does 8:40 work?" → "Ya"
- **AI must update pickupTime on confirmation**

### Pattern 2: Order Build-Up
- Items added incrementally through conversation
- Example: Start with sandwich → Add fries → Add drink
- **AI must accumulate all items, not replace**

### Pattern 3: Combo Notation
- "(2 combo)" means 2 items upgraded
- Combo costs extra ($1.99)
- **AI must parse quantity from parentheses**

### Pattern 4: ASAP Handling
- "asap" → Restaurant proposes time → Customer confirms
- Example: "asap" → "Does 9:15 work?" → "Yes"
- **AI must convert ASAP to confirmed time**

### Pattern 5: Auto-Message Detection
- "Corn On The Corner, This is our storefront location..." = auto greeting
- Not part of actual order conversation
- **AI should not be confused by template messages**

---

## ✅ Implementation Checklist

### Week 1: Core Structured Outputs
- [ ] Create `server/aiSchemas.ts` with Zod schemas
- [ ] Add 5 training examples from real conversations
- [ ] Implement `zodResponseFormat` in `server/utils.ts`
- [ ] Set temperature = 0 for determinism
- [ ] Test with "half sandwich" case → should return `orderMade: false`

### Week 2: Validation & Testing
- [ ] Add business logic validators
- [ ] Create test suite with 5 sample conversations
- [ ] Validate "half sandwich" rejection works
- [ ] Validate combo notation parsing
- [ ] Validate pickup time negotiation

### Week 3: Monitoring & Refinement
- [ ] Log all `reasoning` fields for analysis
- [ ] Track hallucination rate (should be 0%)
- [ ] Monitor confidence scores
- [ ] A/B test: old vs new system
- [ ] Measure accuracy improvement

### Success Metrics:
- ✅ 0% "half sandwich" hallucinations (down from ~5-10%)
- ✅ 100% valid JSON (up from ~95%)
- ✅ 15-25% accuracy improvement overall
- ✅ Reasoning field populated in all responses
- ✅ All 5 test cases pass