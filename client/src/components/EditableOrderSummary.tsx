import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Minus, X, Edit2, ArrowRight, XCircle, ChevronDown } from 'lucide-react';
import type { OrderDetails } from '@shared/schema';

interface EditableOrderSummaryProps {
  orderDetails: OrderDetails;
  orderStatus: 'new' | 'confirmed' | 'ready' | 'completed';
  detectedPickupTime?: string;
  onSave?: (updatedDetails: OrderDetails) => void;
  autoStartEditing?: boolean;
  itemsFromAI?: string[];
  notesFromAI?: string;
  pickupTimeFromAI?: string;
}

interface EditableItem {
  name: string;
  quantity: number;
  price: number;
}

export default function EditableOrderSummary({ 
  orderDetails, 
  orderStatus,
  detectedPickupTime,
  onSave,
  autoStartEditing = false,
  itemsFromAI,
  notesFromAI,
  pickupTimeFromAI
}: EditableOrderSummaryProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedItems, setEditedItems] = useState<EditableItem[]>([]);
  const [editedNotes, setEditedNotes] = useState(orderDetails.notes || '');
  
  // Helper to convert ISO string or formatted string to formatted time
  const formatPickupTime = (timeStr: string | null | undefined): string | null => {
    if (!timeStr) return null;
    
    // If it's already formatted (contains AM/PM), normalize it
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3].toUpperCase();
      
      // Handle formats like "5pm" -> "5:00 PM"
      const formatted = `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
      return formatted;
    }
    
    // If it's an ISO string, convert it
    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return null;
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    } catch {
      // If it's not an ISO string and doesn't match the pattern, return as is
      return timeStr;
    }
  };
  
  const [editedPickupTime, setEditedPickupTime] = useState(
    formatPickupTime(detectedPickupTime || orderDetails.pickupTime) || ''
  );
  const [newItemName, setNewItemName] = useState('');

  // Update editedPickupTime when detectedPickupTime is received
  useEffect(() => {
    if (detectedPickupTime) {
      const formatted = formatPickupTime(detectedPickupTime);
      if (formatted) {
        setEditedPickupTime(formatted);
      }
    }
  }, [detectedPickupTime]);

  // Handle auto-start editing
  useEffect(() => {
    if (autoStartEditing) {
      // Use AI data if available, otherwise use orderDetails
      const itemsToUse = itemsFromAI && itemsFromAI.length > 0 ? itemsFromAI : orderDetails.items;
      const notesToUse = notesFromAI !== undefined ? notesFromAI : (orderDetails.notes || '');
      const pickupTimeToUse = pickupTimeFromAI || detectedPickupTime || formatPickupTime(orderDetails.pickupTime);
      
      setEditedItems(parseItems(itemsToUse));
      setEditedNotes(notesToUse);
      setEditedPickupTime(pickupTimeToUse || (() => {
        const future = new Date(Date.now() + 15 * 60 * 1000);
        let hours = future.getHours();
        let minutes = Math.round(future.getMinutes() / 5) * 5;
        if (minutes >= 60) {
          minutes = 0;
          hours = (hours + 1) % 24;
        }
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;
        return `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
      })());
      setIsEditing(true);
    }
  }, [autoStartEditing, itemsFromAI, notesFromAI, pickupTimeFromAI, detectedPickupTime, orderDetails]);

  const parseItems = (items: string[]): EditableItem[] => {
    return items.map(item => {
      // Handle formats like "Item: $3.50" or "2x Item: $7.00" or "Item" or "2x Item"
      // Try to match price first
      const priceMatch = item.match(/:\s*\$([\d.]+)/);
      let totalPrice = priceMatch ? parseFloat(priceMatch[1]) : null;
      
      // Remove price from item string for further parsing
      const itemWithoutPrice = item.replace(/:\s*\$[\d.]+/, '').trim();
      
      // Try to match quantity
      const quantityMatch = itemWithoutPrice.match(/^(\d+)x\s*(.+)$/i);
      if (quantityMatch) {
        const quantity = parseInt(quantityMatch[1]);
        const name = quantityMatch[2].trim();
        // If we have a total price, divide by quantity to get per-item price
        const pricePerItem = totalPrice !== null ? totalPrice / quantity : 12.99;
        return { name, quantity, price: pricePerItem };
      }
      
      // No quantity, just item name
      const pricePerItem = totalPrice !== null ? totalPrice : 12.99;
      return { name: itemWithoutPrice, quantity: 1, price: pricePerItem };
    });
  };

  const startEditing = () => {
    setEditedItems(parseItems(orderDetails.items));
    setEditedNotes(orderDetails.notes || '');
    // Use detected pickup time if available, otherwise use saved pickup time, otherwise default to 15 minutes from now
    const defaultTime = detectedPickupTime || formatPickupTime(orderDetails.pickupTime) || (() => {
      const future = new Date(Date.now() + 15 * 60 * 1000);
      let hours = future.getHours();
      let minutes = Math.round(future.getMinutes() / 5) * 5;
      
      // Handle minute overflow
      if (minutes >= 60) {
        minutes = 0;
        hours = (hours + 1) % 24;
      }
      
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${hours12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    })();
    setEditedPickupTime(defaultTime);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setNewItemName('');
  };

  const updateQuantity = (index: number, delta: number) => {
    const newItems = [...editedItems];
    newItems[index].quantity = Math.max(1, newItems[index].quantity + delta);
    setEditedItems(newItems);
  };

  const removeItem = (index: number) => {
    setEditedItems(editedItems.filter((_, i) => i !== index));
  };

  const addNewItem = () => {
    if (newItemName.trim()) {
      setEditedItems([...editedItems, { name: newItemName.trim(), quantity: 1, price: 12.99 }]);
      setNewItemName('');
    }
  };

  const calculateTotal = (items: EditableItem[]) => {
    return items.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);
  };

  const saveChanges = () => {
    const formattedItems = editedItems.map(item => 
      item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name
    );
    
    const updatedDetails: OrderDetails = {
      ...orderDetails,
      items: formattedItems,
      total: calculateTotal(editedItems),
      notes: editedNotes || undefined,
      pickupTime: editedPickupTime,
    };

    onSave?.(updatedDetails);
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <Card className="bg-card border-2 border-border">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 flex items-center justify-center">
              <ChevronDown className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm text-foreground">Order Summary</h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={
                orderStatus === 'new' ? 'default' : 
                orderStatus === 'confirmed' ? 'secondary' : 
                'outline'
              }
              data-testid="badge-order-status"
            >
              {orderStatus.toUpperCase()}
            </Badge>
            {orderStatus !== 'ready' && orderStatus !== 'completed' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={startEditing}
                data-testid="button-edit-order"
              >
                <Edit2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="px-4 pb-2">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground">Pickup Time</p>
              <p className="text-xs font-medium" data-testid="text-pickup-time">
                {(() => {
                  // Prioritize detected pickup time, then saved pickup time
                  const timeToShow = detectedPickupTime || orderDetails.pickupTime;
                  if (!timeToShow) return 'Not set';
                  const formatted = formatPickupTime(timeToShow);
                  return formatted || timeToShow; // Fallback to original if formatting fails
                })()}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Total</p>
              <p className="text-xs font-medium" data-testid="text-total">
                ${orderDetails.total}
              </p>
            </div>
          </div>
        </div>
        
        <div className="space-y-2 px-4 mb-3">
          {orderDetails.items.map((item, index) => (
            <div key={index} className="text-sm text-foreground" data-testid={`text-item-${index}`}>
              • {item}
            </div>
          ))}
        </div>

        {orderDetails.notes && (
          <div className="mx-4 mb-3 p-2 bg-muted/50 rounded">
            <p className="text-xs text-muted-foreground mb-1">Notes:</p>
            <p className="text-sm text-foreground" data-testid="text-notes">
              {orderDetails.notes}
            </p>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-card border-2 border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm text-foreground">Edit Order</h3>
        <Badge variant="secondary" data-testid="badge-editing">
          EDITING
        </Badge>
      </div>

      <div className="px-0 pb-2 mb-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground">Pickup Time</p>
            <p className="text-xs font-medium text-primary" data-testid="text-edited-pickup">
              {editedPickupTime}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">New Total</p>
            <p className="text-xs font-medium" data-testid="text-edited-total">
              ${calculateTotal(editedItems)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {editedItems.map((item, index) => (
          <div key={index} className="flex items-center gap-2 p-2 bg-muted/30 rounded">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">${item.price.toFixed(2)} each</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => updateQuantity(index, -1)}
                data-testid={`button-decrease-${index}`}
              >
                <Minus className="w-3 h-3" />
              </Button>
              <span className="w-8 text-center text-sm font-medium" data-testid={`text-quantity-${index}`}>
                {item.quantity}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => updateQuantity(index, 1)}
                data-testid={`button-increase-${index}`}
              >
                <Plus className="w-3 h-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                onClick={() => removeItem(index)}
                data-testid={`button-remove-${index}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <Input
            placeholder="Add item name..."
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNewItem()}
            data-testid="input-new-item"
          />
          <Button
            size="icon"
            onClick={addNewItem}
            disabled={!newItemName.trim()}
            data-testid="button-add-item"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1 block">Pickup Time (e.g., 1:30 PM)</label>
        <Input
          type="text"
          value={editedPickupTime}
          onChange={(e) => setEditedPickupTime(e.target.value)}
          onBlur={(e) => {
            const value = e.target.value.trim();
            const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (match) {
              let hours = parseInt(match[1]);
              let minutes = parseInt(match[2]);
              let period = match[3].toUpperCase();
              
              // Round minutes to nearest 5
              minutes = Math.round(minutes / 5) * 5;
              
              // Handle minute overflow - increment hour and flip AM/PM at 12
              if (minutes >= 60) {
                minutes = 0;
                hours = hours + 1;
                // When crossing from 11:xx to 12:xx, flip AM/PM
                if (hours === 12) {
                  period = period === 'AM' ? 'PM' : 'AM';
                }
              }
              
              // Handle hour overflow
              if (hours >= 13) hours = hours % 12;
              if (hours === 0) hours = 12;
              
              const formattedTime = `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
              setEditedPickupTime(formattedTime);
            }
          }}
          placeholder="1:00 PM"
          data-testid="input-pickup-time"
        />
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1 block">Special Notes</label>
        <Textarea
          placeholder="Any special instructions..."
          value={editedNotes}
          onChange={(e) => setEditedNotes(e.target.value)}
          rows={2}
          data-testid="textarea-notes"
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={cancelEditing}
          data-testid="button-cancel-edit"
        >
          <XCircle className="w-4 h-4 mr-2" />
          Cancel
        </Button>
        <Button
          className="flex-1"
          onClick={saveChanges}
          disabled={editedItems.length === 0}
          data-testid="button-save-edit"
        >
          Send To Preparation
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}
