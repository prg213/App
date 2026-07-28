import React, { createContext, useContext, useEffect, useState } from 'react';
import { getDeviceMac } from '@/services/macAddress';
import { StorageService } from '@/services/storage';
import type { Credentials } from '@/types';

interface AppContextValue {
  isLoading: boolean;
  isActivated: boolean;
  credentials: Credentials | null;
  deviceMac: string;
  setActivated: (creds: Credentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  isLoading: true,
  isActivated: false,
  credentials: null,
  deviceMac: '',
  setActivated: async () => {},
  logout: async () => {},
});

export function AppContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [isActivated, setIsActivated] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [deviceMac, setDeviceMac] = useState('');

  useEffect(() => {
    (async () => {
      const [mac, creds] = await Promise.all([
        getDeviceMac(),
        StorageService.getCredentials(),
      ]);
      setDeviceMac(mac);
      if (creds) {
        setCredentials(creds);
        setIsActivated(true);
      }
      setIsLoading(false);
    })();
  }, []);

  const setActivated = async (creds: Credentials) => {
    try {
      await StorageService.saveCredentials(creds);
    } catch {
      // Storage failure must not block navigation — session still works in-memory
    }
    setCredentials(creds);
    setIsActivated(true);
  };

  const logout = async () => {
    await StorageService.clearCredentials();
    setCredentials(null);
    setIsActivated(false);
  };

  return (
    <AppContext.Provider
      value={{ isLoading, isActivated, credentials, deviceMac, setActivated, logout }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
