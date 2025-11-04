import { ReactNode } from 'react';

interface IPhoneFrameProps {
  children: ReactNode;
}

export default function IPhoneFrame({ children }: IPhoneFrameProps) {
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
