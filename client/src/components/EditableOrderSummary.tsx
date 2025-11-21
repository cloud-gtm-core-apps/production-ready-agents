import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Plus, Minus, X, Edit2, XCircle, ChevronDown } from 'lucide-react';
import type { OrderDetails, MenuItem } from '@shared/schema';

interface EditableOrderSummaryProps {
  orderDetails: OrderDetails;
  orderStatus: 'new' | 'confirmed' | 'ready' | 'completed';
  detectedPickupTime?: string;
  onSave?: (updatedDetails: OrderDetails) => void;
  autoStartEditing?: boolean;
  onCancelEditing?: () => void;
  itemsFromAI?: string[];
  notesFromAI?: string;
  pickupTimeFromAI?: string;
}

export interface EditableOrderSummaryRef {
  saveChanges: () => void;
  triggerSaveWithConfirmation: () => void;
  isEditing: boolean;
}

interface EditableItem {
  name: string;
  quantity: number;
  price: number;
}

const EditableOrderSummary = forwardRef<EditableOrderSummaryRef, EditableOrderSummaryProps>(({ 
  orderDetails, 
  orderStatus,
  detectedPickupTime,
  onSave,
  autoStartEditing = false,
  onCancelEditing,
  itemsFromAI,
  notesFromAI,
  pickupTimeFromAI
}, ref) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedItems, setEditedItems] = useState<EditableItem[]>([]);
  const [editedNotes, setEditedNotes] = useState(orderDetails.notes || '');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
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
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  // Fetch menu items from API
  const { data: menuItems = [], isLoading: isLoadingMenuItems } = useQuery<MenuItem[]>({
    queryKey: ['/api/menu-items'],
    staleTime: 0,
    gcTime: 0,
  });

  // Keep pickup time in sync when not actively editing
  useEffect(() => {
    if (isEditing) {
      return;
    }

    const formatted =
      formatPickupTime(pickupTimeFromAI || detectedPickupTime || orderDetails.pickupTime) || '';

    setEditedPickupTime(formatted);
  }, [pickupTimeFromAI, detectedPickupTime, orderDetails.pickupTime, isEditing]);

  // Handle auto-start editing when Confirm Order button is clicked
  useEffect(() => {
    if (autoStartEditing && !isEditing) {
      // Use AI data if available, otherwise use orderDetails
      const itemsToUse = itemsFromAI && itemsFromAI.length > 0 ? itemsFromAI : orderDetails.items;
      const notesToUse = notesFromAI !== undefined ? notesFromAI : (orderDetails.notes || '');
      const pickupSource = pickupTimeFromAI || detectedPickupTime || orderDetails.pickupTime;
      const pickupTimeToUse = formatPickupTime(pickupSource) || (() => {
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
      })();
      
      setEditedItems(parseItems(itemsToUse));
      setEditedNotes(notesToUse);
      setEditedPickupTime(pickupTimeToUse);
      setIsEditing(true);
    }
  }, [autoStartEditing]); // Only depend on autoStartEditing, not on orderDetails or other props

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
    const defaultSource = pickupTimeFromAI || detectedPickupTime || orderDetails.pickupTime;
    const defaultTime = formatPickupTime(defaultSource) || (() => {
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
    setComboboxOpen(false);
    setSearchValue('');
    // Notify parent to reset autoStartEditing so it can be triggered again
    onCancelEditing?.();
  };

  const updateQuantity = (index: number, delta: number) => {
    const newItems = [...editedItems];
    newItems[index].quantity = Math.max(1, newItems[index].quantity + delta);
    setEditedItems(newItems);
  };

  const removeItem = (index: number) => {
    setEditedItems(editedItems.filter((_, i) => i !== index));
  };

  // Parse price string (e.g., "$12.99") to number
  const parsePrice = (priceStr: string): number => {
    const match = priceStr.match(/\$?([\d.]+)/);
    return match ? parseFloat(match[1]) : 12.99;
  };

  // Handle menu item selection
  const handleMenuItemSelect = (menuItem: MenuItem) => {
    const price = parsePrice(menuItem.price);
    setEditedItems([...editedItems, { name: menuItem.name, quantity: 1, price }]);
    setComboboxOpen(false);
    setSearchValue('');
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

  const triggerSaveWithConfirmation = () => {
    if (editedItems.length === 0) {
      return;
    }
    setShowConfirmDialog(true);
  };

  // Expose methods and state to parent via ref
  useImperativeHandle(ref, () => ({
    saveChanges,
    triggerSaveWithConfirmation,
    isEditing,
  }));

  // Parse items to extract quantity, name, and price (moved outside conditional for reuse)
  const parseItemForDisplay = (item: string): { quantity: string; name: string; price: string } => {
    // Handle formats like "2x Item: $4.99" or "Item: $8.99" or "2x Item" or "Item"
    const quantityMatch = item.match(/^(\d+)x\s/i);
    const quantity = quantityMatch ? quantityMatch[1] : '1';
    
    // Remove quantity prefix
    let itemWithoutQuantity = item.replace(/^\d+x\s+/i, '').trim();
    
    // Extract price if present
    const priceMatch = itemWithoutQuantity.match(/:\s*\$([\d.]+)/);
    const price = priceMatch ? `$${priceMatch[1]}` : '';
    
    // Extract item name (remove price part if present)
    const name = itemWithoutQuantity.replace(/:\s*\$[\d.]+.*$/, '').trim();
    
    return { quantity, name, price };
  };

  if (!isEditing) {
    // Use items from orderDetails if available, otherwise fall back to itemsFromAI
    const itemsToDisplay = (orderDetails.items && orderDetails.items.length > 0) 
      ? orderDetails.items 
      : (itemsFromAI && itemsFromAI.length > 0 ? itemsFromAI : []);

    // Calculate total item count (handling quantities like "2x Item")
    const itemCount = itemsToDisplay.reduce((total, item) => {
      const quantityMatch = item.match(/^(\d+)x\s/i);
      if (quantityMatch) {
        return total + parseInt(quantityMatch[1]);
      }
      return total + 1;
    }, 0);

    // Format pickup time for summary
    const timeToShow = detectedPickupTime || pickupTimeFromAI || orderDetails.pickupTime;
    const formattedTime = timeToShow ? formatPickupTime(timeToShow) || timeToShow : 'Not set';

    // Calculate total from items if not in orderDetails
    let totalToDisplay = orderDetails.total;
    if (!totalToDisplay && itemsToDisplay.length > 0) {
      // Try to extract total from items
      const totalMatch = itemsToDisplay.reduce((sum, item) => {
        const priceMatch = item.match(/:\s*\$([\d.]+)/);
        if (priceMatch) {
          return sum + parseFloat(priceMatch[1]);
        }
        return sum;
      }, 0);
      totalToDisplay = totalMatch > 0 ? totalMatch.toFixed(2) : '0.00';
    }

    // Format summary text
    const summaryText = `${itemCount} ${itemCount === 1 ? 'item' : 'items'} • Pickup Time ${formattedTime}`;

    return (
      <Card className="bg-card border-2 border-border">
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 flex items-center justify-center">
              <ChevronDown className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-medium text-muted-foreground">Order Summary</h3>
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
        
        {/* Items list */}
        {itemsToDisplay.length > 0 && (
          <div className="px-4 pb-2 space-y-1">
            {itemsToDisplay.map((item, index) => {
              const parsed = parseItemForDisplay(item);
              return (
                <div key={index} className="text-xs text-foreground" data-testid={`text-item-${index}`}>
                  {parsed.quantity}x {parsed.name} {parsed.price}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary footer */}
        <div className="px-4 pb-3 pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground" data-testid="text-order-summary">
            {summaryText}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 bg-card border-2 border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm text-foreground">Edit Order</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={cancelEditing}
          className="h-7 px-2 text-xs"
          data-testid="button-cancel-edit-top"
        >
          <XCircle className="w-3.5 h-3.5 mr-1.5" />
          Cancel
        </Button>
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

        <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={comboboxOpen}
              className="w-full justify-between"
              data-testid="button-menu-search"
            >
              <span className="text-muted-foreground">
                {searchValue || "Search menu items..."}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search menu items..."
                value={searchValue}
                onValueChange={setSearchValue}
                data-testid="input-menu-search"
              />
              <CommandList>
                <CommandEmpty>
                  {isLoadingMenuItems ? 'Loading...' : 'No menu items found.'}
                </CommandEmpty>
                <CommandGroup>
                  {menuItems
                    .filter((item) =>
                      item.name.toLowerCase().includes(searchValue.toLowerCase())
                    )
                    .map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.name}
                        onSelect={() => handleMenuItemSelect(item)}
                        className="flex items-center justify-between"
                        data-testid={`menu-item-${item.id}`}
                      >
                        <div className="flex-1">
                          <div className="font-medium">{item.name}</div>
                          {item.category && (
                            <div className="text-xs text-muted-foreground">
                              {item.category}
                            </div>
                          )}
                        </div>
                        <div className="ml-2 font-semibold text-primary">
                          {item.price}
                        </div>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent className="max-w-[280px] p-4">
          <AlertDialogHeader className="pb-2">
            <AlertDialogTitle className="text-base">Send Order to Preparation?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Please make sure there are no mistakes before sending this order to preparation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 pt-2">
            <AlertDialogCancel className="m-0 flex-1 text-xs h-8">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowConfirmDialog(false);
                saveChanges();
              }}
              className="flex-1 text-xs h-8"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
});

EditableOrderSummary.displayName = 'EditableOrderSummary';

export default EditableOrderSummary;
