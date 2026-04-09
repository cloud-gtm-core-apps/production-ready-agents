import asyncio
from google.adk.runners import Runner
from app.agent import root_agent, get_session_service, get_memory_service, get_artifact_service

from google.genai.types import Content

class SimpleAgentRunner:
    """
    A simplified runner that interacts with the root_agent directly.
    Replaces the complex AdkAgentToA2AExecutor.
    """
    def __init__(self):
        # Initialize the Runner with services from agent.py
        self.runner = Runner(
            app_name="restaurant_order_agent",
            agent=root_agent,
            session_service=get_session_service(),
            memory_service=get_memory_service(),
            artifact_service=get_artifact_service()
        )

    async def chat(self, user_id: str, session_id: str, message: str):
        """Sends a message and prints the response."""
        
        # Ensure the session exists before running
        session = await self.runner.session_service.get_session(
            app_name=self.runner.app_name,
            user_id=user_id,
            session_id=session_id
        )
        if session is None:
            await self.runner.session_service.create_session(
                app_name=self.runner.app_name,
                user_id=user_id,
                session_id=session_id,
                state={}
            )

        print("Agent: ", end="", flush=True)

        content = Content(role="user", parts=[{"text": message}])

        # run_async handles everything: history, tool calls, and LLM orchestration
        async for event in self.runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content
        ):
            # Detect tool calls to show the user the agent is working
            func_calls = event.get_function_calls()
            if func_calls:
                for fc in func_calls:
                    print(f"\n[Tool: {fc.name}]", end="", flush=True)

            if event.is_final_response():
                if event.content and event.content.parts:
                    # Safely extract text from the parts
                    text_parts = [p.text for p in event.content.parts if p.text]
                    if text_parts:
                        print(" ".join(text_parts))
                    else:
                        print("[Done (no text response)]")

async def main():
    bot = SimpleAgentRunner()
    print("--- Starting Restaurant Order Agent (Interactive Mode) ---")
    print("(Type 'exit' or 'quit' to stop, or press Ctrl+C/Ctrl+D)")
    
    user_id = "user_1"
    session_id = f"session_{int(asyncio.get_event_loop().time())}" # Unique session per run

    while True:
        try:
            # input() is blocking but acceptable for this CLI
            user_input = input("\nYou: ")
            
            if user_input.lower() in ["exit", "quit"]:
                print("Goodbye!")
                return
            
            if not user_input.strip():
                continue

            await bot.chat(user_id, session_id, user_input)
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            return

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # Catch interaction with asyncio.run's own signal handling
        pass