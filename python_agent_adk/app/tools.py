from datetime import datetime
import re
import math

from google.adk.agents import Agent
from google.adk.tools import google_search
from google.adk.tools.agent_tool import AgentTool


# ----- Example of a Function tool -----
def get_current_date() -> dict:
    """
    Get the current date in the format YYYY-MM-DD
    """
    return {"current_date": datetime.now().strftime("%Y-%m-%d")}


# def record_order(items: list[str], customer_name: str, notes: str = "") -> str:
#     """
#     Records a completed restaurant order. 
#     Use this tool when a customer has finished specifying their order.
#     
#     Args:
#         items: A list of menu items ordered.
#         customer_name: The name of the customer.
#         notes: Any special instructions or notes.
#     """
#     # In a real tool, we might update a database or session here.
#     # For now, we return a confirmation message.
#     print(f"TOOL CALL: record_order(items={items}, customer_name={customer_name}, notes={notes})")
#     return f"Order recorded for {customer_name}. Items: {', '.join(items)}"




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


STATE_SALES_TAX_RATES = {
    "alabama": 0.0400, "al": 0.0400,
    "alaska": 0.0000, "ak": 0.0000,
    "arizona": 0.0560, "az": 0.0560,
    "arkansas": 0.0650, "ar": 0.0650,
    "california": 0.0725, "ca": 0.0725,
    "colorado": 0.0290, "co": 0.0290,
    "connecticut": 0.0635, "ct": 0.0635,
    "delaware": 0.0000, "de": 0.0000,
    "florida": 0.0600, "fl": 0.0600,
    "georgia": 0.0400, "ga": 0.0400,
    "hawaii": 0.0400, "hi": 0.0400,
    "idaho": 0.0600, "id": 0.0600,
    "illinois": 0.0625, "il": 0.0625,
    "indiana": 0.0700, "in": 0.0700,
    "iowa": 0.0600, "ia": 0.0600,
    "kansas": 0.0650, "ks": 0.0650,
    "kentucky": 0.0600, "ky": 0.0600,
    "louisiana": 0.0445, "la": 0.0445,
    "maine": 0.0550, "me": 0.0550,
    "maryland": 0.0600, "md": 0.0600,
    "massachusetts": 0.0625, "ma": 0.0625,
    "michigan": 0.0600, "mi": 0.0600,
    "minnesota": 0.06875, "mn": 0.06875,
    "mississippi": 0.0700, "ms": 0.0700,
    "missouri": 0.04225, "mo": 0.04225,
    "montana": 0.0000, "mt": 0.0000,
    "nebraska": 0.0550, "ne": 0.0550,
    "nevada": 0.0685, "nv": 0.0685,
    "new hampshire": 0.0000, "nh": 0.0000,
    "new jersey": 0.06625, "nj": 0.06625,
    "new mexico": 0.05125, "nm": 0.05125,
    "new york": 0.0400, "ny": 0.0400,
    "north carolina": 0.0475, "nc": 0.0475,
    "north dakota": 0.0500, "nd": 0.0500,
    "ohio": 0.0575, "oh": 0.0575,
    "oklahoma": 0.0450, "ok": 0.0450,
    "oregon": 0.0000, "or": 0.0000,
    "pennsylvania": 0.0600, "pa": 0.0600,
    "rhode island": 0.0700, "ri": 0.0700,
    "south carolina": 0.0600, "sc": 0.0600,
    "south dakota": 0.0450, "sd": 0.0450,
    "tennessee": 0.0700, "tn": 0.0700,
    "texas": 0.0625, "tx": 0.0625,
    "utah": 0.0610, "ut": 0.0610,
    "vermont": 0.0600, "vt": 0.0600,
    "virginia": 0.0530, "va": 0.0530,
    "washington": 0.0650, "wa": 0.0650,
    "west virginia": 0.0600, "wv": 0.0600,
    "wisconsin": 0.0500, "wi": 0.0500,
    "wyoming": 0.0400, "wy": 0.0400,
    "district of columbia": 0.0600, "dc": 0.0600,
}


def calculate_order_total(items: list[str], state: str = "California") -> str:
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
        
    tax_rate = STATE_SALES_TAX_RATES.get(state.lower().strip(), 0.0)
    tax = math.ceil((total * tax_rate) * 100) / 100
    total_with_tax = total + tax
    result = f"Total price for {', '.join(found_details)}: ${total_with_tax:.2f} (Subtotal: ${total:.2f}, Tax: ${tax:.2f})"
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