# Product Guidelines

These guidelines define the standards for AI behavior, system tone, and data integrity for the ORDERFLOW Agent Optimizations.

## Tone and Style
- **Professional & Explicit**: All AI-generated summaries and technical communications must be clear, structured, and formal to eliminate ambiguity.
- **Technical & Detailed**: Documentation and UI metadata should provide high-level technical details (e.g., model version, specific reasoning) to aid in debugging and verification.

## Determinism and Predictability
- **Predictability First**: We prioritize strict, consistent JSON outputs. The system must be tuned (via low temperature/top-p) to ensure that the same input yields the exact same extraction results every time. This is critical for reliable API integration and UI state management.

## Validation and Safety
- **Strict Schema Validation**: The system must enforce high standards for AI extraction. If a conversation does not meet the strict schema requirements or contains significant ambiguity, the extraction should fail entirely rather than providing a "best guess," ensuring the manager is notified to handle the data manually for safety.

## User Experience (UI/UX)
- **Simplified Technical View**: The dashboard should prioritize finalized, actionable data for the manager. However, it must include an easily accessible "Technical Details" toggle to expose latency, model metadata, and validation logs for troubleshooting.

## State Management
- **Full Context Re-extraction**: To maintain a consistent source of truth, the system will re-process the entire conversation history from scratch whenever a customer provides a correction or a new message. This ensures the current state always reflects the most up-to-date conversation context.
