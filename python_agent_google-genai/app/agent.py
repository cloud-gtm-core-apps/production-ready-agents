from ..adk.core import Agent
from .strategies import analyze_order_summary, suggest_response
import json

class OrderFlowAgent(Agent):
    def __init__(self):
        super().__init__(name="OrderFlowAgent")
    
    async def process_message(self, message: str) -> str:
        # 1. Add user message to history
        self.context.add_message("user", message)
        
        # 2. Analyze for order
        print(" [Thinking...] analyzing order...")
        order_result = analyze_order_summary(self.context.conversation_history)
        
        if order_result.orderMade and order_result.orderDetails:
            # Store order in state
            self.context.state["current_order"] = order_result.orderDetails.dict()
            print(f" [Order Detected]: {json.dumps(order_result.orderDetails.dict(), indent=2)}")
        
        # 3. Generate suggested response
        print(" [Thinking...] generating response...")
        suggestion = suggest_response(self.context.conversation_history)
        
        response = suggestion or "I'm not sure how to respond to that."
        
        # 4. Add agent response to history (simulating that the manager sent it)
        # Note: In a real system, we might wait for approval, but here the agent acts as the system.
        self.context.add_message("assistant", response)
        
        return response
