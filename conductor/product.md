# Initial Concept
This project, ORDERFLOW, is an AI-powered restaurant order management system designed to process customer SMS messages, automatically detect orders, and provide a real-time dashboard for managers. The current focus is on **Agent Optimizations**, specifically targeting AI accuracy, latency, and costs through better determinism, model selection, and memory management.

# Product Vision
To provide a robust, efficient, and highly accurate AI layer for restaurant ordering that reduces manual overhead for managers while ensuring a seamless, reliable experience for end customers.

# Target Users
- **Restaurant Managers**: Rely on the dashboard for accurate, fast order updates and AI-assisted communication.
- **End Customers**: SMS users who require reliable, low-latency order detection and confirmation.

# Key Goals
- **Accuracy & Reliability**: Improve order extraction (items, quantities, pickup times) and significantly reduce errors.
- **Performance & Determinism**: Reduce latency and ensure consistent AI behavior across different runs through tuned hyperparameters (Temperature, Top-P).
- **Cost & Efficiency**: Transition to more cost-effective models (Trucube/Llama) and optimize token usage without sacrificing quality.

# Primary Features (Optimization Focus)
- **Determinism & Consistency**: Ensuring predictable, high-quality JSON outputs for structured data extraction.
- **Hallucination Reduction**: Eliminating the addition of non-existent items or times in AI summaries.
- **Hyperparameter Tuning**: Implementing task-specific settings for temperature and top-p to maximize model reliability.
