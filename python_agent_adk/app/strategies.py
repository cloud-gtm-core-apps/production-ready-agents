import os
import json
from typing import List, Optional, Dict
from google.genai import types
from google.adk.models import LlmRequest
from pydantic import BaseModel
from .adk_extensions import VertexGemini

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

def build_menu_context() -> str:
    return """
MENU ITEMS:
Pizzas:
  - Cheese Pizza: $12.00
  - Pepperoni Pizza: $14.00
  - Veggie Pizza: $13.00

Sandwiches:
  - Turkey Sandwich: $10.00
  - Ham Sandwich: $10.00
  - Lunch Special (1/2 Sandwich + Soup): $12.00

Drinks:
  - Soda: $2.50
  - Water: $1.50
"""

async def analyze_order_summary(history: List[Dict[str, str]], customer_name: str = "Customer") -> OrderSummaryResult:
    conversation_text = format_conversation(history)
    menu_context = build_menu_context()
    
    system_prompt = f"""You are an order detection system for a restaurant. Analyze the conversation and determine if the customer has placed an order.
  
  IMPORTANT: {menu_context}
  
  CRITICAL RULES:
  - ONLY include items that are in the menu provided above.
  - NEVER include 1/2 sandwich requests. If a customer mentions a 1/2 sandwich, ignore it.
  
  If an order has been placed, extract:
  1. Customer name
  2. All items ordered (be specific, include quantities and prices)
  3. Any special notes
  
  Return only valid JSON:
  {{
    "orderMade": boolean,
    "orderDetails": {{
        "customerName": string,
        "items": string[],
        "notes": string
    }}
  }}
  
  If no order has been made, return: {{"orderMade": false}}"""

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

async def suggest_response(history: List[Dict[str, str]]) -> Optional[str]:
    # Only suggest if the last message is from the user
    if not history or history[-1].get("role") != "user":
        return None
        
    conversation_text = format_conversation(history)
    
    system_prompt = """You are helping a restaurant manager write responses to customers. Generate a short, natural, human-sounding response.
    
    Guidelines:
    - Keep it brief (under 40 words)
    - Sound natural and casual
    - Be helpful but not overly enthusiastic
    - Just provide the response text itself
    """
    
    prompt = f"""
    System: {system_prompt}
    
    User: Conversation:
    {conversation_text}
    """
    
    model = get_model()
    
    try:
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        request = LlmRequest(
            model=MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(
                temperature=0.7
            )
        )
        
        response_text = ""
        async for chunk in model.generate_content_async(request):
             if chunk.content and chunk.content.parts:
                 for part in chunk.content.parts:
                     if part.text:
                         response_text += part.text

        return response_text.strip()
    except Exception as e:
        print(f"Error in suggest_response: {e}")
        return None
