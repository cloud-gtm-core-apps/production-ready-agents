import NotificationBanner from '../NotificationBanner';

export default function NotificationBannerExample() {
  return (
    <div className="relative h-48 bg-background">
      <NotificationBanner
        title="Corn on the Corner"
        message="New order from John Smith - Crispy Cancun"
        onDismiss={() => console.log('Notification dismissed')}
      />
    </div>
  );
}
