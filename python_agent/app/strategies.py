import os
import json
from typing import List, Optional, Dict
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig
from .models import OrderSummaryResult, ConditionalAIOutput, OrderDetails

# Initialize Vertex AI
# Ensure GOOGLE_APPLICATION_CREDENTIALS is set or environment is authenticated
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

if project_id:
    vertexai.init(project=project_id, location=location)

def format_conversation(history: List[Dict[str, str]]) -> str:
    formatted = []
    for msg in history:
        sender = "Customer" if msg["role"] == "user" else "Restaurant"
        formatted.append(f"{sender}: {msg['content']}")
    return "\n".join(formatted)

def build_menu_context() -> str:
    # Simplified mock menu for this agent
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

def analyze_order_summary(history: List[Dict[str, str]], customer_name: str = "Customer") -> OrderSummaryResult:
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

    try:
        model = GenerativeModel("gemini-3-flash-preview") # Using Gemini 1.5 Flash (assuming 'gemini 3' was a typo or referring to next gen)
        
        prompt = f"""
        System: {system_prompt}
        
        User: Analyze this conversation:
        
        {conversation_text}
        
        Customer name: {customer_name}
        """
        
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        content = response.text
        if not content:
            return OrderSummaryResult(orderMade=False)
            
        data = json.loads(content)
        if data.get("orderMade") and data.get("orderDetails"):
            return OrderSummaryResult(
                orderMade=True,
                orderDetails=OrderDetails(**data["orderDetails"])
            )
        return OrderSummaryResult(orderMade=False)
    except Exception as e:
        print(f"Error in analyze_order_summary: {e}")
        return OrderSummaryResult(orderMade=False)

def suggest_response(history: List[Dict[str, str]]) -> Optional[str]:
    # Only suggest if the last message is from the user
    if not history or history[-1]["role"] != "user":
        return None
        
    conversation_text = format_conversation(history)
    
    system_prompt = """You are helping a restaurant manager write responses to customers. Generate a short, natural, human-sounding response.
    
    Guidelines:
    - Keep it brief (under 40 words)
    - Sound natural and casual
    - Be helpful but not overly enthusiastic
    - Just provide the response text itself
    """
    
    try:
        model = GenerativeModel("gemini-1.5-flash-002")
        
        prompt = f"""
        System: {system_prompt}
        
        User: Conversation:
        {conversation_text}
        """
        
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=0.7
            )
        )
        return response.text.strip()
    except Exception as e:
        print(f"Error in suggest_response: {e}")
        return None
