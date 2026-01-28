import sys
import os
import asyncio
from google.genai.types import Content

# Ensure we can import from local directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from python_agent_adk.app.agent import get_agent, get_session_service, get_memory_service
from google.adk.runners import Runner
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

async def run_loop():
    print("Initializing Restaurant Order Agent (ADK)...")
    
    # Get agent and services from ServiceManager
    agent = get_agent()
    session_service = get_session_service()
    memory_service = get_memory_service()
    
    # Create Runner
    runner = Runner(
        app_name="restaurant_order_agent",
        agent=agent,
        session_service=session_service,
        artifact_service=InMemoryArtifactService(),
        memory_service=memory_service,
    )
    
    user_id = "local_user"
    session_id = "interactive_session"
    
    print("Agent started. Type 'quit' to exit.")
    
    # Create or get session
    session = await session_service.get_session(
        app_name="restaurant_order_agent",
        user_id=user_id,
        session_id=session_id,
    )
    if session is None:
        session = await session_service.create_session(
            app_name="restaurant_order_agent",
            user_id=user_id,
            session_id=session_id,
            state={},
        )
    
    while True:
        try:
            user_input = input("You: ")
            if user_input.lower() in ["quit", "exit"]:
                break
            
            # Create content for the message
            content = Content(role="user", parts=[{"text": user_input}])
            
            # Run agent and collect response
            response_text = ""
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
            
            if response_text:
                print(f"Agent: {response_text}")
            else:
                print("Agent: (no response)")
            
        except KeyboardInterrupt:
            print("\nExiting...")
            break
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()

def main():
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("WARNING: GOOGLE_CLOUD_PROJECT not set.")
    
    asyncio.run(run_loop())

if __name__ == "__main__":
    main()
