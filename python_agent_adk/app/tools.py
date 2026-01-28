from datetime import datetime

from google.adk.agents import Agent
from google.adk.tools import google_search
from google.adk.tools.agent_tool import AgentTool


# ----- Example of a Function tool -----
def get_current_date() -> dict:
    """
    Get the current date in the format YYYY-MM-DD
    """
    return {"current_date": datetime.now().strftime("%Y-%m-%d")}


def record_order(items: list[str], customer_name: str, notes: str = "") -> str:
    """
    Records a completed restaurant order. 
    Use this tool when a customer has finished specifying their order.
    
    Args:
        items: A list of menu items ordered.
        customer_name: The name of the customer.
        notes: Any special instructions or notes.
    """
    # In a real tool, we might update a database or session here.
    # For now, we return a confirmation message.
    print(f"TOOL CALL: record_order(items={items}, customer_name={customer_name}, notes={notes})")
    return f"Order recorded for {customer_name}. Items: {', '.join(items)}"


# ----- Example of a Built-in Tool -----
search_agent = Agent(
    model="gemini-2.5-flash",
    name="search_agent",
    instruction="""
    You're a specialist in Google Search.
    """,
    tools=[google_search],
)

search_tool = AgentTool(search_agent)