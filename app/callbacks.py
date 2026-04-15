import re
from typing import Optional
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types as genai_types
from .config import settings
import json

# Define as a module-level constant so it's easy to update and idempotency-guard against
DETERMINISM_DIRECTIVE = "\n\n[System directive: Answer concisely and strictly based on the menu context.]"


async def before_model_callback(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    if not llm_request.contents:
        return None

    last_user_content = next(
        (c for c in reversed(llm_request.contents) if c.role == "user"), None
    )
    if not last_user_content or not last_user_content.parts:
        return None

    text_part = next((p for p in last_user_content.parts if p.text is not None), None)
    if text_part and isinstance(text_part.text, str):
        original_text = text_part.text.strip()
        cc_pattern = r'\b(?:\d[ -]*?){13,16}\b'
        # 1. Validation & Short-circuit (reject truly empty/single-char inputs)
        if len(original_text) < 2:
            response_dict = {
                "agent_response": "I didn't quite catch that. Could you please provide more details?"
            }
            return LlmResponse(
                content=genai_types.Content(
                    role='model',
                    parts=[genai_types.Part.from_text(
                        text=json.dumps(response_dict)
                    )]
                )
            )
        elif re.search(cc_pattern, original_text):
            response_dict = {
                "agent_response": "cc info found. I cannot process that."
            }
            return LlmResponse(
                content=genai_types.Content(
                    role='model',
                    parts=[genai_types.Part.from_text(
                        text=json.dumps(response_dict)
                    )]
                )
            )

        # 2. Idempotent Prompt Cleaning & Determinism Directive Injection
        if DETERMINISM_DIRECTIVE not in text_part.text:
            text_part.text = original_text + DETERMINISM_DIRECTIVE

    return None


async def after_model_callback(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    if not llm_response.content or not llm_response.content.parts:
        return None

    text_part = next(
        (p for p in llm_response.content.parts if p.text is not None), None
    )
    if text_part and isinstance(text_part.text, str):
        original_text = text_part.text

        # Safety guardrails
        cc_pattern = r'\b(?:\d[ -]*?){13,16}\b'
        banned_words = settings.banned_words  # sourced from config

        violation_found = False
        if re.search(cc_pattern, original_text):
            violation_found = True
        elif any(w.lower() in original_text.lower() for w in banned_words):
            violation_found = True

        if violation_found:
            response_dict = {
                "agent_response": "I apologize, but I cannot fulfill that request due to safety policies. Can I help you with your restaurant order instead?"
            }
            # Return a NEW LlmResponse — do not mutate the original
            return LlmResponse(
                content=genai_types.Content(
                    role='model',
                    parts=[genai_types.Part.from_text(
                        text=json.dumps(response_dict)
                    )]
                )
            )

    return None
