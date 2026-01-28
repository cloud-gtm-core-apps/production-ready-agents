import asyncio
from typing import Callable, List, Dict, Any, Optional
from dataclasses import dataclass, field

@dataclass
class Context:
    """
    Holds the state of the conversation and any other context needed by the agent.
    """
    conversation_history: List[Dict[str, Any]] = field(default_factory=list)
    state: Dict[str, Any] = field(default_factory=dict)
    
    def add_message(self, role: str, content: str):
        self.conversation_history.append({"role": role, "content": content})

class Agent:
    """
    Base Agent class representing a simplified ADK agent.
    """
    def __init__(self, name: str):
        self.name = name
        self.context = Context()
        
    async def process_message(self, message: str) -> str:
        """
        Process an incoming message and return a response.
        Must be implemented by subclasses.
        """
        raise NotImplementedError("Subclasses must implement process_message")
        
    def run(self):
        """
        Simple CLI event loop for testing/running the agent locally.
        """
        print(f"Agent {self.name} started. Type 'quit' to exit.")
        asyncio.run(self._repl())

    async def _repl(self):
        while True:
            try:
                user_input = input("You: ")
                if user_input.lower() in ["quit", "exit"]:
                    break
                
                response = await self.process_message(user_input)
                print(f"{self.name}: {response}")
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")
