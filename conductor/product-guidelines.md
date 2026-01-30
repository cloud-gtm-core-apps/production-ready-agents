# Product Guidelines

These guidelines define the standards for AI behavior, system tone, and data integrity for the ORDERFLOW Agent.

## Tone and Style
- **Professional & Explicit**: All AI-generated responses and summaries must be clear, structured, and formal to eliminate ambiguity.
- **Helpful & Efficient**: The agent should prioritize speed and accuracy in detecting orders, providing concise confirmations to users.

## Determinism and Predictability
- **Predictability First**: We prioritize strict, consistent extraction. The system must be tuned (via low temperature/top-p) to ensure that the same input yields the exact same extraction results every time. This is critical for reliable order processing.

## Validation and Safety
- **Strict Schema Validation**: The system must enforce high standards for AI extraction. If an input is ambiguous or does not meet requirements, the agent should politely ask for clarification rather than making a "best guess."

## Agent Interaction Design
- **Clear Confirmations**: When an order is detected, the agent must provide a clear, itemized summary for the user to confirm.
- **Graceful Failure**: If the agent cannot process a request, it should provide a clear reason or ask for specific missing information (e.g., quantity, pickup time).

## State Management
- **Full Context Re-extraction**: To maintain a consistent source of truth, the system re-processes relevant conversation history to ensure the current order state always reflects the most up-to-date context provided by the customer.