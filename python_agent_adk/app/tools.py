from datetime import datetime
import re

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


def calculate_order_total(items: list[str]) -> str:
    """
    Calculates the total price for a list of menu items.
    Handles quantities if specified (e.g. '2 x Cheese Pizza' or '2 Soda').
    
    Args:
        items: A list of items to calculate the total for.
    """
    total = 0.0
    found_details = []
    missing_items = []
    
    for raw_item in items:
        raw_item = raw_item.strip()
        # Match quantity if present: "2x Cheese Pizza", "2 Cheese Pizza", "2 Cheese Pizzas"
        match = re.match(r'^(\d+)\s*(?:x|times)?\s*(.*)', raw_item, re.IGNORECASE)
        if match:
            quantity = int(match.group(1))
            item_name = match.group(2).strip()
        else:
            quantity = 1
            item_name = raw_item

        # Try to find the item in MENU
        price = MENU.get(item_name)
        if price is not None:
            total += price * quantity
            found_details.append(f"{quantity}x {item_name}" if quantity > 1 else item_name)
        else:
            # Try case-insensitive and simple plural stripping
            matched = False
            for menu_item, menu_price in MENU.items():
                if (item_name.lower() == menu_item.lower() or 
                    item_name.lower().rstrip('s') == menu_item.lower().rstrip('s')):
                    total += menu_price * quantity
                    found_details.append(f"{quantity}x {menu_item}" if quantity > 1 else menu_item)
                    matched = True
                    break
            if not matched:
                missing_items.append(raw_item)
                
    if not found_details and not missing_items:
        return "No items provided to calculate."
        
    result = f"Total price for {', '.join(found_details)}: ${total:.2f}"
    if missing_items:
        result += f" (Note: {', '.join(missing_items)} not found in menu)"
    return result


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