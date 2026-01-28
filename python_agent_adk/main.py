import sys
import os
import asyncio

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_agent_adk.app.agent import OrderFlowAgent

async def run_loop():
    print("Initializing OrderFlowAgent (ADK, Async)...")
    agent = OrderFlowAgent()
    print("Agent started. Type 'quit' to exit.")
    
    while True:
        try:
            user_input = input("You: ")
            if user_input.lower() in ["quit", "exit"]:
                break
            
            response = await agent.process_message(user_input)
            print(f"Agent: {response}")
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"Error: {e}")

def main():
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("WARNING: GOOGLE_CLOUD_PROJECT not set.")
    
    asyncio.run(run_loop())

if __name__ == "__main__":
    main()
