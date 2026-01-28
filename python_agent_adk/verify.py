import sys
import os
import asyncio

# Ensure import paths
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_agent_adk.app.agent import OrderFlowAgent

async def verify_agent():
    print("--- Starting Verification for Python ADK Agent (Async) ---")
    
    # Initialize
    try:
        agent = OrderFlowAgent()
    except Exception as e:
        print(f"FAILED to initialize agent: {e}")
        return

    # Test 1: Greeting
    print("\n--- Test 1: Greeting ---")
    msg1 = "Hi there"
    print(f"User: {msg1}")
    resp1 = await agent.process_message(msg1)
    print(f"Agent: {resp1}")
    
    if len(resp1) > 0:
        print("[PASS] Agent responded.")
    else:
        print("[FAIL] Agent did not respond.")

    # Test 2: Order
    print("\n--- Test 2: Ordering Pizza ---")
    msg2 = "I'd like a cheese pizza please"
    print(f"User: {msg2}")
    resp2 = await agent.process_message(msg2)
    print(f"Agent: {resp2}")
    
    # Check State
    current_order = agent.state.get("current_order")
    if current_order and "Cheese Pizza" in str(current_order.get("items", [])):
        print(f"[PASS] Order detected: {current_order}")
    else:
        print(f"[FAIL] Order NOT detected. Current state: {current_order}")

if __name__ == "__main__":
    asyncio.run(verify_agent())
