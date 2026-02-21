from google.adk.agents import Agent
from google.adk.tools import google_search
from google.adk.tools.agent_tool import AgentTool



MENU = {
    "Cheese Pizza": 12.00,
    "Pepperoni Pizza": 14.00,
    "Veggie Pizza": 13.00,
    "Turkey Sandwich": 10.00,
    "Ham Sandwich": 10.00,
    "Lunch Special (1/2 Sandwich + Soup)": 12.00,
    "Soda": 2.50,
    "Water": 1.50,
}


def build_menu_context() -> str:
    """
    Returns the current restaurant menu as a string.
    """
    menu_str = "MENU ITEMS:\nPizzas:\n"
    for item, price in MENU.items():
        if "Pizza" in item:
            menu_str += f"  - {item}: ${price:.2f}\n"
    
    menu_str += "\nSandwiches:\n"
    for item, price in MENU.items():
        if "Sandwich" in item or "Special" in item:
            menu_str += f"  - {item}: ${price:.2f}\n"
            
    menu_str += "\nDrinks:\n"
    for item, price in MENU.items():
        if item in ["Soda", "Water"]:
            menu_str += f"  - {item}: ${price:.2f}\n"
            
    return menu_str


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