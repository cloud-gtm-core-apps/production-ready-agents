# Specification - Optimize Python ADK Agent: Architecture and Determinism

## Overview
The goal of this track is to improve the reliability, determinism, and maintainability of the Python ADK agent by refactoring its core architecture. This involves centralizing configuration, enforcing strict schemas for AI outputs using Pydantic, and moving formatting logic from prompts to Python code.

## Goals
- **Centralized Configuration**: All environment-dependent settings (model names, prompt templates) should be managed in `app/config.py`.
- **Strict Data Contracts**: Use Pydantic models in `app/schemas.py` to define exactly what the LLM should return.
- **Deterministic Extraction**: Use `response_schema` and `temperature=0` to treat the LLM as a data extraction engine.
- **Code-First Formatting**: Extract raw data from the LLM and format it for the user using deterministic Python functions.

## Technical Details
- **Configuration**: Use Pydantic Settings or simple environment variable loading in `app/config.py`.
- **Schemas**: Define `OrderSummaryResult` and `OrderItem` models.
- **Strategies**: Update `app/strategies.py` to use `generate_content` with `response_schema`.
- **Formatting**: Implement `format_order_summary` in `app/strategies.py` or a dedicated module.
