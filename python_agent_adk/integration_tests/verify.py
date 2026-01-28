import sys
import os
import asyncio

# Ensure import paths
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google.genai.types import Content
from app.agent import get_agent, get_session_service, get_memory_service
from google.adk.runners import Runner
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

async def verify_agent():
    print("--- Starting Verification for Python ADK Agent (Async) ---")
    
    # Initialize services and runner
    try:
        agent = get_agent()
        session_service = get_session_service()
        memory_service = get_memory_service()
        
        runner = Runner(
            app_name="restaurant_order_agent",
            agent=agent,
            session_service=session_service,
            artifact_service=InMemoryArtifactService(),
            memory_service=memory_service,
        )
    except Exception as e:
        print(f"FAILED to initialize services: {e}")
        return

    user_id = "test_user"
    session_id = "test_session"
    
    # Ensure session exists
    session = await session_service.get_session(
        app_name="restaurant_order_agent", user_id=user_id, session_id=session_id
    )
    if not session:
        session = await session_service.create_session(
            app_name="restaurant_order_agent", 
            user_id=user_id, 
            session_id=session_id, 
            state={}
        )

    async def send_message(text):
        print(f"\nUser: {text}")
        content = Content(role="user", parts=[{"text": text}])
        response_text = ""
        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session.id,
                new_message=content
            ):
                if event.is_final_response():
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.text:
                                response_text += part.text
            print(f"Agent: {response_text}")
        except Exception as e:
            print(f"Error during run_async: {e}")
        return response_text

    # Test 1: Greeting
    print("\n--- Test 1: Greeting ---")
    resp1 = await send_message("Hi there")
    if resp1:
        print("[PASS] Agent responded.")
    else:
        print("[FAIL] Agent did not respond.")

    # Test 2: Order
    print("\n--- Test 2: Ordering Pizza ---")
    # We use a very explicit order to trigger the record_order tool
    resp2 = await send_message("I'd like a cheese pizza please. My name is Yanni.")
    
    # Check if the response suggests the order was recorded
    if "recorded" in resp2.lower() or "cheese pizza" in resp2.lower():
        print("[PASS] Order processed/confirmed by agent.")
    else:
        print(f"[FAIL] Order processing might have failed. Response: {resp2}")
    
    # Test 3: Multiple items
    print("\n--- Test 3: Multiple items ---")
    resp3 = await send_message("Also add a soda and water.")
    if "soda" in resp3.lower() and "water" in resp3.lower():
        print("[PASS] Additional items acknowledged.")
    else:
        print(f"[FAIL] Acknowledgment failed. Response: {resp3}")

if __name__ == "__main__":
    asyncio.run(verify_agent())
