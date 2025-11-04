import { X, LayoutDashboard, BarChart3, History, UtensilsCrossed, Settings, Users, UserCircle, UserCog, LogIn, LogOut, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocation } from 'wouter';

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: string;
  isActive?: boolean;
}

export default function SideDrawer({ isOpen, onClose }: SideDrawerProps) {
  const [, setLocation] = useLocation();

  const handleMenuClick = async (section: string) => {
    if (section === 'settings') {
      setLocation('/settings');
      onClose();
    } else if (section === 'menu') {
      setLocation('/menu');
      onClose();
    } else if (section === 'signin') {
      setLocation('/login');
      onClose();
    } else if (section === 'signout') {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        setLocation('/login');
        onClose();
      } catch (error) {
        console.error('Logout failed:', error);
      }
    }
  };

  const menuSections = [
    {
      title: 'Operations',
      items: [
        { label: 'Orders', icon: ShoppingBag, section: 'orders', isActive: true },
        { label: 'Dashboard', icon: LayoutDashboard, section: 'dashboard' },
        { label: 'Analytics', icon: BarChart3, section: 'analytics' },
        { label: 'Order History', icon: History, section: 'history' },
      ]
    },
    {
      title: 'Management',
      items: [
        { label: 'Menu Items', icon: UtensilsCrossed, section: 'menu' },
        { label: 'Settings', icon: Settings, section: 'settings' },
        { label: 'Customers', icon: Users, section: 'customers' },
      ]
    },
    {
      title: 'Team',
      items: [
        { label: 'Manage Users', icon: UserCog, section: 'users' },
        { label: 'My Profile', icon: UserCircle, section: 'profile' },
      ]
    },
    {
      title: 'Account',
      items: [
        { label: 'Sign In', icon: LogIn, section: 'signin' },
        { label: 'Sign Out', icon: LogOut, section: 'signout' },
      ]
    }
  ];

  return (
    <>
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        data-testid="drawer-backdrop"
      />

      <div
        className={cn(
          "absolute top-0 left-0 bottom-0 w-[280px] bg-black border-r border-border z-50 transition-all duration-300 ease-out",
          isOpen ? "translate-x-0 visible" : "-translate-x-full invisible pointer-events-none"
        )}
        data-testid="side-drawer"
        aria-hidden={!isOpen}
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">C</span>
              </div>
              <div>
                <h2 className="font-bold text-sm text-foreground">Corn on the Corner</h2>
                <p className="text-xs text-muted-foreground">Rod's Dashboard</p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              data-testid="button-close-drawer"
              className="rounded-md"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4">
            {menuSections.map((section, sectionIndex) => (
              <div key={section.title} className={cn("px-3 mb-6", sectionIndex > 0 && "pt-2 border-t border-border/30")}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.section}
                        onClick={() => handleMenuClick(item.section)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left",
                          item.isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "text-foreground hover-elevate active-elevate-2"
                        )}
                        data-testid={`menu-item-${item.section}`}
                      >
                        <Icon className={cn("w-5 h-5", item.isActive ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-sm">{item.label}</span>
                        {item.isActive && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="px-4 py-4 border-t border-border">
            <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted/30">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <UserCircle className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">Rod (Manager)</p>
                <p className="text-xs text-muted-foreground">Dearborn Location</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
