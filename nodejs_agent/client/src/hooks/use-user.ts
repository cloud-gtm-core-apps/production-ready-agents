import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useEffect } from 'react';

interface AuthResponse {
  user: {
    id: string;
    email: string;
  };
}

export function useUser(options?: { redirectTo?: string }) {
  const [, setLocation] = useLocation();
  
  const { data, isLoading, error } = useQuery<AuthResponse>({
    queryKey: ['/api/auth/me'],
    retry: false,
  });

  useEffect(() => {
    if (!isLoading && error && options?.redirectTo) {
      setLocation(options.redirectTo);
    }
  }, [isLoading, error, options?.redirectTo, setLocation]);

  return {
    user: data?.user || null,
    isLoading,
    isAuthenticated: !isLoading && !error && !!data?.user,
  };
}
