from pydantic import BaseModel, Field, field_validator
from enum import Enum
from typing import List, Optional

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

class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"

class OrderItem(BaseModel):
    name: str = Field(..., description="The name of the menu item.")
    quantity: int = Field(..., description="The quantity of the item.")
    special_instructions: Optional[str] = Field(None, description="Any special requests or modifications (e.g., 'no onions').")

    @field_validator("name")
    @classmethod
    def reject_half_sandwich(cls, v: str) -> str:
        # Rule: No half sandwiches except in the Lunch Special
        lower_v = v.lower()
        if ("half" in lower_v or "1/2" in lower_v) and "lunch special" not in lower_v:
             raise ValueError("We do not offer half sandwiches as individual items. They are only available as part of our Lunch Special.")
        return v

    @field_validator("name")
    @classmethod
    def validate_item_exists(cls, v: str) -> str:
        # Case-insensitive check
        menu_items = {k.lower(): k for k in MENU.keys()}
        if v.lower() not in menu_items:
            raise ValueError(f"Item '{v}' is not in our menu. Please choose from: {', '.join(MENU.keys())}")
        return menu_items[v.lower()]
    

class Order(BaseModel):
    customer_name: str = Field(..., description="The name of the customer.")
    items: List[OrderItem] = Field(..., description="The list of items in the order.")
    notes: Optional[str] = Field(None, description="Any special instructions or notes.")
    total_price: Optional[float] = Field(None, description="The total price of the order (before tax).")

class OrderSummaryResult(BaseModel):
    reasoning: str = Field(..., description="Step-by-step logic for identifying the items and quantities from the conversation.")
    agent_response: str = Field(..., description="The natural language response to send back to the user (e.g., 'Sure, I've added that to your order' or a listing of the menu).")
    confidence: ConfidenceLevel = Field(..., description="Overall confidence level in the extraction.")
    order_made: bool = Field(..., description="Whether a valid order was successfully identified and recorded.")
    items: List[OrderItem] = Field(default_factory=list, description="A list of the items found in the order.")

    @field_validator('items')
    @classmethod
    def validate_menu_items(cls, items: List[OrderItem]) -> List[OrderItem]:
        # Reference Menu from the README/Prompt
        VALID_ITEMS = {
            "Cheese Pizza", "Pepperoni Pizza", "Veggie Pizza",
            "Turkey Sandwich", "Ham Sandwich", "Lunch Special",
            "Soda", "Water"
        }
        for item in items:
            if item.name not in VALID_ITEMS:
                raise ValueError(f"'{item.name}' is not a valid menu item. Valid items are: {', '.join(sorted(VALID_ITEMS))}")
        return items
