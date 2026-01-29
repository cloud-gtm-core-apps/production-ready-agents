import os
import json
from typing import List, Optional, Dict
from google.genai import types
from google.adk.models import LlmRequest
from pydantic import BaseModel
from .adk_extensions import VertexGemini
from .tools import build_menu_context


# Data Models
class OrderDetails(BaseModel):
    customerName: str
    items: List[str]
    notes: Optional[str] = ""

class OrderSummaryResult(BaseModel):
    orderMade: bool
    orderDetails: Optional[OrderDetails] = None

# We instantiate the model here or inside functions. 
# Instantiating once is better for cache but stateless functions are safer.
# Using 'global' location and 'gemini-3-flash-preview' as requested.
MODEL_NAME = "gemini-3-flash-preview"

# Initialize model helper
def get_model():
    return VertexGemini(model=MODEL_NAME)

def format_conversation(history: List[Dict[str, str]]) -> str:
    formatted = []
    for msg in history:
        sender = "Customer" if msg.get("role") == "user" else "Restaurant"
        formatted.append(f"{sender}: {msg.get('content', '')}")
    return "\n".join(formatted)




ORDER_DETECTION_SYSTEM_PROMPT = """You are a helpful restaurant order assistant. Help customers with their orders in a friendly, natural way.

{menu_context}

IMPORTANT RULES:
- ONLY include items that are in the menu provided above.
- Use the 'record_order' tool when the customer specifies items they want to order. 
- When calling 'record_order', provide the list of items, customer name (if known, otherwise 'Customer'), and any notes.
- Use ```{menu_context}``` if you need to see the full list of available items or if the customer asks for the menu.
- Use the 'load_memory' tool to access any previous orders or notes.
- Always show price for each menu item.
- Keep responses brief (under 40 words).
- Be helpful but not overly enthusiastic
"""



async def analyze_order_summary(history: List[Dict[str, str]], customer_name: str = "Customer") -> OrderSummaryResult:
    conversation_text = format_conversation(history)
    menu_context = build_menu_context()
    
    system_prompt = ORDER_DETECTION_SYSTEM_PROMPT.format(menu_context=menu_context)

    prompt = f"""
    System: {system_prompt}
    
    User: Analyze this conversation:
    
    {conversation_text}
    
    Customer name: {customer_name}
    """

    model = get_model()
    
    try:
        # Create LlmRequest
        # ADK's generate_content_async takes LlmRequest
        # We need to construct contents manually using google.genai.types
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        
        request = LlmRequest(
            model=MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        response_text = ""
        async for chunk in model.generate_content_async(request):
             # chunk is LlmResponse
             # We need to aggregate text.
             # Based on google_llm.py logic, it processes parts.
             if chunk.content and chunk.content.parts:
                 for part in chunk.content.parts:
                     if part.text:
                         response_text += part.text
        
        if not response_text:
            return OrderSummaryResult(orderMade=False)
            
        data = json.loads(response_text)
        if data.get("orderMade") and data.get("orderDetails"):
            return OrderSummaryResult(
                orderMade=True,
                orderDetails=OrderDetails(**data["orderDetails"])
            )
        return OrderSummaryResult(orderMade=False)
    except Exception as e:
        print(f"Error in analyze_order_summary: {e}")
        return OrderSummaryResult(orderMade=False)

RESPONSE_SUGGESTION_SYSTEM_PROMPT = """You are a helpful restaurant assistant. Suggest a response to the customer based on the conversation history.
Keep it brief and helpful.
"""

async def suggest_response(history: List[Dict[str, str]]) -> str:
    conversation_text = format_conversation(history)
    prompt = f"""
    System: {RESPONSE_SUGGESTION_SYSTEM_PROMPT}
    
    User: Suggest a response for this conversation:
    
    {conversation_text}
    """

    model = get_model()
    try:
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        request = LlmRequest(model=MODEL_NAME, contents=contents)
        response_text = ""
        async for chunk in model.generate_content_async(request):
            if chunk.content and chunk.content.parts:
                for part in chunk.content.parts:
                    if part.text:
                        response_text += part.text
        return response_text
    except Exception as e:
        print(f"Error in suggest_response: {e}")
        return "I'm sorry, I'm having trouble responding right now."
