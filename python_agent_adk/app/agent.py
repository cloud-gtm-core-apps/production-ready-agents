import logging
import json
from typing import Dict, Any, Optional

try:
    from adk import Agent
except ImportError:
    # Placeholder if not installed
    class Agent:
        def __init__(self, name: str):
            self.name = name
            self.state = {}

from .strategies import analyze_order_summary, suggest_response

class OrderFlowAgent(Agent):
    def __init__(self, name: str = "OrderFlowAgent"):
        super().__init__(name=name)
        self.state = {
            "conversation_history": [],
            "current_order": None
        }

    async def process_message(self, message: str) -> str:
        """
        Processes a user message (Async):
        1. Updates history
        2. Detects order
        3. Generates response
        """
        # 1. Update history
        self.state["conversation_history"].append({"role": "user", "content": message})
        
        # 2. Analyze for order
        order_result = await analyze_order_summary(self.state["conversation_history"])
        
        if order_result.orderMade and order_result.orderDetails:
            self.state["current_order"] = order_result.orderDetails.model_dump()
            print(f" [Order Detected]: {json.dumps(self.state['current_order'], indent=2)}")
            
        # 3. Suggest Response
        suggestion = await suggest_response(self.state["conversation_history"])
        response = suggestion or "I'm not sure how to respond to that."
        
        # 4. Update history with response
        self.state["conversation_history"].append({"role": "assistant", "content": response})
        
        return response
