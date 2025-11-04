interface MenuItemCardProps {
  name: string;
  price: string;
  imageUrl: string;
  onSelect?: () => void;
}

export default function MenuItemCard({ name, price, imageUrl, onSelect }: MenuItemCardProps) {
  return (
    <button
      onClick={onSelect}
      className="flex items-center gap-3 w-full bg-card rounded-xl p-3 border border-border hover-elevate active-elevate-2"
      data-testid={`button-menu-item-${name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <img
        src={imageUrl}
        alt={name}
        className="w-16 h-16 rounded-lg object-cover shrink-0"
      />
      <div className="flex-1 text-left">
        <h4 className="font-semibold text-sm">{name}</h4>
        <p className="text-sm text-muted-foreground mt-0.5">{price}</p>
      </div>
    </button>
  );
}
