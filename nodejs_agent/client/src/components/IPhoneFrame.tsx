import { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

interface IPhoneFrameProps {
  children: ReactNode;
}

export default function IPhoneFrame({ children }: IPhoneFrameProps) {
  const isMobile = useIsMobile();

  // On mobile devices, render without frame - full screen
  if (isMobile) {
    return (
      <div className="fixed inset-0 w-full h-full bg-black overflow-hidden">
        <div className="relative w-full h-full">
          {children}
        </div>
      </div>
    );
  }

  // On desktop, show the iPhone frame for preview
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-muted to-background p-4">
      <div className="relative w-full max-w-[393px] h-[852px] bg-black rounded-[60px] shadow-2xl overflow-hidden">
        <div className="absolute inset-0 rounded-[60px] overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[200px] h-[30px] bg-black rounded-b-3xl z-50" />
          {children}
        </div>
      </div>
    </div>
  );
}
