import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, RefreshCw, Trash2, Edit2 } from "lucide-react";
import { useLocation } from "wouter";
import IPhoneFrame from "@/components/IPhoneFrame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import IOSStatusBar from "@/components/IOSStatusBar";
import type { MenuItem } from "@shared/schema";

export default function MenuManagement() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState({ name: '', price: '', category: '' });

  // Fetch menu items from API
  const { data: menuItems = [], isLoading } = useQuery<MenuItem[]>({
    queryKey: ['/api/menu-items'],
    staleTime: 0,
    gcTime: 0,
  });

  const handleAddItem = async () => {
    if (!formData.name || !formData.price) return;
    
    try {
      const response = await fetch('/api/menu-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          price: formData.price,
          category: formData.category || null,
        }),
      });

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
        setFormData({ name: '', price: '', category: '' });
        setIsAddDialogOpen(false);
      } else {
        // Handle error response
        const errorData = await response.json();
        alert(errorData.message || 'Failed to add menu item');
      }
    } catch (error) {
      console.error('Error adding menu item:', error);
      alert('Failed to add menu item. Please try again.');
    }
  };

  const handleEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({ name: item.name, price: item.price, category: item.category || '' });
    setIsEditDialogOpen(true);
  };

  const handleUpdateItem = async () => {
    if (!editingItem || !formData.name || !formData.price) return;
    
    try {
      const response = await fetch(`/api/menu-items/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          price: formData.price,
          category: formData.category || null,
        }),
      });

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
        setFormData({ name: '', price: '', category: '' });
        setIsEditDialogOpen(false);
        setEditingItem(null);
      } else {
        // Handle error response
        const errorData = await response.json();
        alert(errorData.message || 'Failed to update menu item');
      }
    } catch (error) {
      console.error('Error updating menu item:', error);
      alert('Failed to update menu item. Please try again.');
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this menu item?')) return;
    
    try {
      const response = await fetch(`/api/menu-items/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      }
    } catch (error) {
      console.error('Error deleting menu item:', error);
    }
  };

  const handleSyncClover = async () => {
    try {
      const response = await fetch('/api/integrations/clover/sync-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const error = await response.json();
        let errorMessage = error.message || 'Failed to sync menu items from Clover. Please try again.';
        
        // If reconnection is required, provide helpful message
        if (error.requiresReconnect) {
          errorMessage += '\n\nPlease go to Settings and reconnect your Clover account.';
        }
        
        const errorDetails = error.details ? `\n\nDetails: ${error.details}` : '';
        const statusCode = error.statusCode ? `\n\nStatus Code: ${error.statusCode}` : '';
        alert(`${errorMessage}${statusCode}${errorDetails}`);
        return;
      }

      const result = await response.json();
      
      // Invalidate menu items query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/menu-items'] });
      
      // Show success message
      if (result.errors && result.errors.length > 0) {
        alert(`Synced ${result.synced} items from Clover. Some errors occurred:\n${result.errors.join('\n')}`);
      } else {
        alert(`Successfully synced ${result.synced} menu items from Clover!`);
      }
    } catch (error) {
      console.error('Error syncing menu items from Clover:', error);
      alert('Failed to sync menu items from Clover. Please try again.');
    }
  };

  // Check Clover connection status
  const { data: cloverStatus } = useQuery<{ connected: boolean }>({
    queryKey: ['/api/integrations/clover/status'],
  });

  const cloverConnected = cloverStatus?.connected || false;

  const categories = Array.from(new Set(menuItems.map(item => item.category).filter(Boolean)));

  return (
    <IPhoneFrame>
      <div className="h-full flex flex-col bg-background">
        <IOSStatusBar />

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold text-foreground" data-testid="text-menu-title">
            Menu Management
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Menu Item</DialogTitle>
                  <DialogDescription>
                    Add a new item to your menu
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="add-name">Item Name</Label>
                    <Input
                      id="add-name"
                      placeholder="e.g., Classic Elote Cup"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-price">Price</Label>
                    <Input
                      id="add-price"
                      placeholder="e.g., $8.99"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-category">Category (optional)</Label>
                    <Input
                      id="add-category"
                      placeholder="e.g., Elote Cups"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddItem}>Add Item</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-6">
          <div className="p-4 space-y-4">
            {/* Loading State */}
            {isLoading && (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">Loading menu items...</p>
                </CardContent>
              </Card>
            )}

            {/* Menu Items by Category */}
            {!isLoading && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-foreground">Menu Items</h2>
                  {cloverConnected && (
                    <Button 
                      variant="outline" 
                      onClick={handleSyncClover}
                      data-testid="button-sync-clover"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sync from Clover
                    </Button>
                  )}
                </div>
            {categories.length > 0 ? (
              categories.map(category => (
                <Card key={category}>
                  <CardHeader>
                    <CardTitle className="text-lg">{category}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {menuItems
                      .filter(item => item.category === category)
                      .map(item => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-md border border-border bg-card hover-elevate group"
                        >
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm text-foreground">{item.name}</h4>
                            <p className="text-sm text-primary font-medium mt-0.5">{item.price}</p>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => handleEditItem(item)}
                              data-testid={`button-edit-${item.id}`}
                            >
                              <Edit2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => handleDeleteItem(item.id)}
                              data-testid={`button-delete-${item.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">No menu items yet. Add your first item!</p>
                </CardContent>
              </Card>
            )}

            {/* Items without category */}
            {menuItems.filter(item => !item.category).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Other Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {menuItems
                    .filter(item => !item.category)
                    .map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-md border border-border bg-card hover-elevate group"
                      >
                        <div className="flex-1">
                          <h4 className="font-semibold text-sm text-foreground">{item.name}</h4>
                          <p className="text-sm text-primary font-medium mt-0.5">{item.price}</p>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleEditItem(item)}
                            data-testid={`button-edit-${item.id}`}
                          >
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => handleDeleteItem(item.id)}
                            data-testid={`button-delete-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}
              </>
            )}
          </div>
        </div>

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Menu Item</DialogTitle>
              <DialogDescription>
                Update the details of this menu item
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Item Name</Label>
                <Input
                  id="edit-name"
                  placeholder="e.g., Classic Elote Cup"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-price">Price</Label>
                <Input
                  id="edit-price"
                  placeholder="e.g., $8.99"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">Category (optional)</Label>
                <Input
                  id="edit-category"
                  placeholder="e.g., Elote Cups"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateItem}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </IPhoneFrame>
  );
}

