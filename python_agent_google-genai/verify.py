import asyncio
import os
import sys
from unittest.mock import MagicMock, patch

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_agent.app.agent import OrderFlowAgent



async def run_verification():
    print("Starting verification (Simulated Vertex AI Conversation)...")
    
    # Patch the GenAI Client in strategies
    # Since 'client' is a global variable in strategies.py, we patch it directly
    with patch('python_agent.app.strategies.client') as mock_client:
        
        # Setup mock responses
        # 1. No Order (Greeting)
        mock_response_no_order = MagicMock()
        mock_response_no_order.text = '{"orderMade": false}'
        
        # 2. Suggestion (Greeting)
        mock_response_suggestion = MagicMock()
        mock_response_suggestion.text = "Hi! How can I help you today?"
        
        # 3. Order (Pizza)
        mock_response_order = MagicMock()
        mock_response_order.text = '{"orderMade": true, "orderDetails": {"customerName": "Alice", "items": ["1x Cheese Pizza"], "notes": "No onions"}}'
        
        # 4. Suggestion (Pizza)
        mock_response_suggestion_order = MagicMock()
        mock_response_suggestion_order.text = "Got it, one cheese pizza. Anything else?"
        
        # Configure side effects for client.models.generate_content
        # We need to simulate the sequence of calls:
        # 1. analyze_order_summary (Greeting)
        # 2. suggest_response (Greeting)
        # 3. analyze_order_summary (Order)
        # 4. suggest_response (Order)
        mock_client.models.generate_content.side_effect = [
            mock_response_no_order,
            mock_response_suggestion,
            mock_response_order,
            mock_response_suggestion_order
        ]
        
        agent = OrderFlowAgent()
        
        # Test 1: Simple Greeting
        print("\n--- Test 1: Greeting ---")
        msg1 = "Hi there"
        print(f"User: {msg1}")
        resp1 = await agent.process_message(msg1)
        print(f"Agent: {resp1}")
        
        # Assertions
        assert "current_order" not in agent.context.state, "Should not have order yet"
        
        # Test 2: Placing Order
        print("\n--- Test 2: Ordering Pizza ---")
        msg2 = "I'd like a cheese pizza please"
        print(f"User: {msg2}")
        resp2 = await agent.process_message(msg2)
        print(f"Agent: {resp2}")
        
        # Assertions
        assert "current_order" in agent.context.state, "Order should be in state"
        order = agent.context.state["current_order"]
        assert order["customerName"] == "Alice"
        assert "1x Cheese Pizza" in order["items"]
        print("\n[SUCCESS] Order detected and stored in state correctly.")

if __name__ == "__main__":
    asyncio.run(run_verification())
