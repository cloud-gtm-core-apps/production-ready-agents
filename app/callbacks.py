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

def _print_memory_diagnostics(callback_context: CallbackContext, llm_request: LlmRequest, total_history_count: int) -> None:
    # --- DEEP MEMORY INSPECTION (Visualizing all events in storage) ---
    if settings.enable_storage_inspector:
        session_id = getattr(callback_context.session, "id", "Unknown")
        print("\n" + "💾" * 30, flush=True)
        print(f"  [SHORT-TERM MEMORY (Session Service) INSPECTOR] Session: {session_id}", flush=True)
        print(f"  TOTAL EVENTS IN SHORT-TERM MEMORY: {total_history_count}", flush=True)
        print("  --- FULL SHORT-TERM HISTORY ---", flush=True)
        
        for i, content in enumerate(llm_request.contents):
            role = content.role.upper()
            msg_preview = ""
            if content.parts:
                p = content.parts[0]
                # Check for tool call vs text
                if hasattr(p, "function_call") and p.function_call:
                    msg_preview = f"[TOOL CALL: {p.function_call.name}]"
                elif hasattr(p, "function_response") and p.function_response:
                    msg_preview = f"[TOOL RESPONSE: {p.function_response.name}]"
                elif hasattr(p, "text") and isinstance(p.text, str):
                    msg_preview = p.text[:50].replace('\n', ' ') + "..."
                else:
                    msg_preview = "..."
            
            print(f"    [{i+1}/{total_history_count}] {role}: {msg_preview}", flush=True)
        print("💾" * 30 + "\n", flush=True)

    # --- LONG-TERM MEMORY INSPECTOR (Visualizing all data in MemoryService) ---
    if settings.enable_memory_inspector:
        try:
            # Access the underlying memory service if available in development
            inv_ctx = getattr(callback_context, "_invocation_context", None)
            if inv_ctx:
                memory_svc = getattr(inv_ctx, "memory_service", None)
                if memory_svc and hasattr(memory_svc, "_session_events"):
                    user_key = f"{inv_ctx.app_name}/{inv_ctx.user_id}"
                    user_memories = memory_svc._session_events.get(user_key, {})
                    total_mem_events = sum(len(evts) for evts in user_memories.values())
                    
                    print("🧠" * 30, flush=True)
                    print(f"  [LONG-TERM MEMORY (Memory Service) INSPECTOR] User: {user_key}", flush=True)
                    print(f"  TOTAL FACTS IN LONG-TERM MEMORY: {total_mem_events}", flush=True)
                    print("  --- FULL LONG-TERM MEMORY ---", flush=True)
                    if total_mem_events == 0:
                        print("    No memory saved yet.", flush=True)
                    else:
                        count = 1
                        for sid, evts in user_memories.items():
                            for event in evts:
                                role = event.author.upper() if event.author else "UNKNOWN"
                                txt = ""
                                if getattr(event, "content", None) and getattr(event.content, "parts", None):
                                    texts = [p.text for p in event.content.parts if hasattr(p, "text") and isinstance(p.text, str)]
                                    txt = " ".join(texts)
                                txt_preview = txt[:50].replace("\n", " ") + "..."
                                print(f"    [{count}/{total_mem_events}] {role}: {txt_preview}", flush=True)
                                count += 1
                    print("🧠" * 30 + "\n", flush=True)
        except Exception as e:
            print(f"  [LONG-TERM MEMORY INSPECTOR] Error displaying memory: {e}", flush=True)

async def before_model_callback(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    if not llm_request.contents:
        return None

    ##############################
    # start of sliding window task
    ##############################
    if settings.enable_sliding_window_task:
        total_history_count = len(llm_request.contents)

        # 1. Print visualizer diagnostics
        _print_memory_diagnostics(callback_context, llm_request, total_history_count)

        # --- SLIDING WINDOW: ATOMIC CHUNKING (Architectural Best Practice) ---
        was_truncated = False
        max_turns = settings.max_history_turns
        total_turns = 1
        shifted_count = 0    

        if settings.enable_sliding_window:

            # 1. PIN SYSTEM INSTRUCTIONS (These should never slide away)
            pinned_system_messages = []
            dialogue_messages = []
            
            for content in llm_request.contents:
                if content.role == "system":
                    pinned_system_messages.append(content)
                else:
                    dialogue_messages.append(content)

            # 2. GROUP THE DIALOGUE INTO TURNS
            turns = []
            current_turn = []
            
            for content in dialogue_messages:
                # Check if this user message is actually a backend Tool Response
                is_tool_response = False
                if content.parts and hasattr(content.parts[0], "function_response"):
                    if content.parts[0].function_response:
                        is_tool_response = True
                        
                # A new turn starts only if it's a genuine human user message
                if content.role == "user" and not is_tool_response and current_turn:
                    turns.append(current_turn)
                    current_turn = []
                current_turn.append(content)
            
            # Catch the "Dangling Turn" (final interaction after the loop)
            if current_turn:
                turns.append(current_turn)

            # 3. SLICE THE TURNS
            total_turns = len(turns)
            
            if total_turns > max_turns:
                was_truncated = True
                original_message_count = len(llm_request.contents)
                turns = turns[-max_turns:]
                
                # Flatten the dialogue turns
                flattened_dialogue = [msg for turn in turns for msg in turn]
                
                # 4. RE-ATTACH PINNED SYSTEM MESSAGES
                llm_request.contents = pinned_system_messages + flattened_dialogue
                shifted_count = original_message_count - len(llm_request.contents)
                
                print(f"\n[ADK CALLBACK] 🧩 ATOMIC CHUNKING ACTIVE (System Instructions Pinned 📌)", flush=True)
                print(f"    Turns Sent to Model:   {max_turns}", flush=True)
                print(f"    Messages Dropped:      {total_history_count - len(llm_request.contents)}", flush=True)
                print(f"    Final Message Count:   {len(llm_request.contents)}", flush=True)
        else:
            print(f"\n[ADK CALLBACK] 🟢 SLIDING WINDOW DISABLED (Sending full history: {total_history_count} messages)", flush=True)
        # ---------------------------------------------------------------------
        
        print(f"    Total Grouped Turns: {total_turns}/{settings.max_history_turns}", flush=True)
        print(f"    Hard Limit:        {'ENABLED 🚫' if settings.enforce_hard_limit else 'DISABLED 🟢'}", flush=True)

        # --- LIVE HISTORY LOGGING ---
        header_color = "🟢" if not was_truncated else "🟡"
        print("\n" + "="*60, flush=True)
        print(f"{header_color}  LLM CONTEXT WINDOW (Size: {len(llm_request.contents)})", flush=True)
        if was_truncated:
            print(f"    (Reduced from {total_history_count} total session messages)", flush=True)
        print("="*60, flush=True)
        
        for i, content in enumerate(llm_request.contents):
            role = content.role.upper()
            msg_preview = ""
            if content.parts:
                p = content.parts[0]
                # Check for tool call vs text
                if hasattr(p, "function_call") and p.function_call:
                    msg_preview = f"[TOOL CALL: {p.function_call.name}]"
                elif hasattr(p, "function_response") and p.function_response:
                    msg_preview = f"[TOOL RESPONSE: {p.function_response.name}]"
                elif hasattr(p, 'text') and isinstance(p.text, str):
                    msg_preview = p.text[:50].replace('\n', ' ') + "..."
                else:
                    msg_preview = "..."
            
            # Calculate the real ID based on the total history
            real_id = (total_history_count - len(llm_request.contents)) + i + 1
            print(f"[{real_id}/{total_history_count}] {role}: {msg_preview}", flush=True)
        print("="*60 + "\n", flush=True)
        # ----------------------------

        # --- FULL CONTENT SNAPSHOT FOR UI ---
        snapshot = "--- LLM PROMPT CONTEXT SNAPSHOT ---\n"
        for i, content in enumerate(llm_request.contents):
            txt = ""
            if content.parts:
                txt = " ".join([p.text if hasattr(p, "text") and isinstance(p.text, str) else "[non-text-part]" for p in content.parts])
            snapshot += f"\n[{content.role.upper()}]: {txt}\n"
        callback_context.state["_context_snapshot"] = snapshot
        # ------------------------------------

        callback_context.state["_history_total"] = total_history_count
        callback_context.state["_history_sent"] = len(llm_request.contents)
        callback_context.state["_was_truncated"] = was_truncated
        callback_context.state["_turn_aware_shifted"] = (shifted_count > 0)

        # Optional Hard-Cap Check
        window_was_full = callback_context.state.get("_window_was_full", False)
        if settings.enforce_hard_limit and window_was_full:
            return LlmResponse(
                content=genai_types.Content(
                    role='model',
                    parts=[genai_types.Part.from_text(
                        text=f"🚫 Demo Limit Reached: The conversation has exceeded the maximum limit of {settings.max_history_turns} historical turns. The agent is blocked from processing further messages. Please start a new session."
                    )]
                )
            )
            
        if total_turns >= settings.max_history_turns:
            callback_context.state["_window_was_full"] = True
        ############################
        # end of sliding window task
        ############################

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

    ##############################
    # start of sliding window task
    ##############################
    if settings.enable_sliding_window_task:
        # Automatically distills and saves the whole conversation as memory
        try:
            await callback_context.add_session_to_memory()
        except Exception as e:
            print(f"[ADK CALLBACK] Failed to automatically save session to memory: {e}", flush=True)

        return None
    ############################
    # end of sliding window task
    ############################