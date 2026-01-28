# Application Code Extraction vs AI Extraction

This document explains the architectural shift from "AI Formatting" to "Application Code Extraction" using Zod schemas.

## The Core Problem: "Split Brain" Logic

Currently, the responsibility for data extraction and formatting is dangerously split between the AI model and the application code.

### 1. Current Workflow (Flawed)
We ask the AI to do **everything**: Detect, Extract, and Format.

*   **Prompt:** "Extract items and format them as `2x Item Name: $Price`."
*   **AI Output:** A JSON object where `items` is an array of strings like `["2x Burger: $20.00"]`.
*   **The Risk:** The AI is non-deterministic. It might return:
    *   `["2 Burger $20"]` (Missing 'x' and ':')
    *   `["Burger: 20"]` (Missing '$')
    *   `["Two Burgers"]` (Completely wrong format)

Because the AI's output is unreliable, we have "fallback" code in `server/utils.ts` (`formatOrderMessage`) that tries to repair or re-format the data if the AI messed up. This means we have two places trying to do the same job, and neither is 100% authoritative.

## The Solution: Separation of Concerns

We will separate the responsibilities cleanly:

### 1. AI Responsibility: Pure Data Extraction
The AI's job is reduced to the cognitive task only: **Understanding the conversation.**

*   **New Prompt:** "Extract the item name and quantity as structured data."
*   **New Output (Zod Enforced):**
    ```json
    {
      "items": [
        { "name": "Burger", "quantity": 2, "unitPrice": 10.00 }
      ]
    }
    ```
*   **Why Zod Helps:**
    *   **GPT Models:** The API *forces* the model to output this exact structure. It cannot hallucinations keys or wrong types.
    *   **Llama Models:** We validate the output with Zod immediately. If the model returns garbage, we catch it instantly instead of crashing later.

### 2. Application Responsibility: Deterministic Formatting
The formatting logic moves entirely into our TypeScript code.

*   **Code Logic:**
    ```typescript
    const formattedItem = quantity > 1
       ? `${quantity}x ${name}: $${(unitPrice * quantity).toFixed(2)}`
       : `${name}: $${unitPrice.toFixed(2)}`;
    ```
*   **The Result:** `2x Burger: $20.00`
*   **Why This is Better:** This code **never** fails. It **always** produces the exact string format our frontend expects. It is 100% deterministic.

## Implementation Details

### Location of Code
*   **Old Logic (to be removed):** Complex formatting instructions in `server/aiFunctions.ts` (`buildOrderSummaryPrompt`).
*   **New Logic (to be added):**
    *   **Schemas:** `server/aiSchemas.ts` (Defines the data structure).
    *   **Formatting:** `server/utils.ts` (Inside `OpenAIOrderSummary` / `TrucubeOrderSummary`). We map the clean Zod data to the legacy string format right before returning it.

### Summary
By using Zod, we treat the AI as a **reliable data source** rather than a **text generator**. This shift allows us to write stable, predictable code that handles the presentation layer, leaving the AI to focus on what it does best: understanding natural language.
