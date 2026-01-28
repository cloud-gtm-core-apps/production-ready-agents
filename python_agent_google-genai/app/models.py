from pydantic import BaseModel
from typing import List, Optional

class Message(BaseModel):
    role: str
    content: str

class OrderDetails(BaseModel):
    customerName: str
    items: List[str]
    pickupTime: Optional[str] = None
    notes: Optional[str] = None

class OrderSummaryResult(BaseModel):
    orderMade: bool
    orderDetails: Optional[OrderDetails] = None

class ConditionalAIOutput(BaseModel):
    edgeCaseDetected: bool
    edgeCaseType: Optional[str] = None
    orderDetails: Optional[OrderDetails] = None
    suggestedResponse: Optional[str] = None
