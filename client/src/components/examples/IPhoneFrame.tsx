import IPhoneFrame from '../IPhoneFrame';

export default function IPhoneFrameExample() {
  return (
    <IPhoneFrame>
      <div className="flex items-center justify-center h-full bg-background text-foreground">
        <p className="text-lg">iPhone Frame Content</p>
      </div>
    </IPhoneFrame>
  );
}
