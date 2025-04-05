
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { simulationApi, SIMULATION_MESSAGES } from '@/services/simulationApi';
import { useWebSocket } from '@/hooks/use-websocket';
import { WebSocketState } from '@/services/websocket';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

// Define the context type
interface SimulationContextType {
  isConnected: boolean;
  connectionState: WebSocketState;
  connectToServer: (url: string, authToken?: string) => void;
  disconnectFromServer: () => void;
  connectionError: string | null;
}

// Create the context with a default value
const SimulationContext = createContext<SimulationContextType>({
  isConnected: false,
  connectionState: 'closed',
  connectToServer: () => {},
  disconnectFromServer: () => {},
  connectionError: null
});

// Context provider component
export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [serverUrl, setServerUrl] = useState<string | undefined>(undefined);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  
  // Use the WebSocket hook
  const { 
    connectionState, 
    isConnected,
    connect, 
    disconnect 
  } = useWebSocket({
    url: serverUrl,
    reconnectOnMount: !!serverUrl,
    authToken: authToken,
    onMessage: (message) => {
      // Handle global message processing if needed
      console.log('WebSocket message received:', message);
    }
  });

  // Show toast notifications for connection state changes
  useEffect(() => {
    if (connectionState === 'open') {
      setConnectionError(null);
      toast({
        title: "Подключено к серверу",
        description: "Соединение с сервером симуляции установлено."
      });

      // Invalidate cached data to fetch fresh data from the server
      queryClient.invalidateQueries({ queryKey: ['athletes'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } else if (connectionState === 'error') {
      setConnectionError("Не удалось подключиться к серверу симуляции");
      toast({
        title: "Ошибка соединения",
        description: "Не удалось подключиться к серверу симуляции.",
        variant: "destructive"
      });
    } else if (connectionState === 'closed' && serverUrl) {
      // Only show this toast if we were previously trying to connect
      toast({
        title: "Соединение закрыто",
        description: "Соединение с сервером симуляции было закрыто."
      });
    }
  }, [connectionState, serverUrl, queryClient]);

  // Connect to the simulation server
  const connectToServer = (url: string, token?: string) => {
    try {
      setServerUrl(url);
      setAuthToken(token);
      connect(url, token);
      simulationApi.init(url, token);
      setConnectionError(null);
      
      toast({
        title: "Подключение...",
        description: "Попытка подключения к серверу симуляции."
      });
    } catch (error) {
      console.error("Error connecting to server:", error);
      setConnectionError("Ошибка при подключении к серверу");
      toast({
        title: "Ошибка подключения",
        description: "Не удалось инициализировать подключение к серверу",
        variant: "destructive"
      });
    }
  };

  // Disconnect from the simulation server
  const disconnectFromServer = () => {
    try {
      disconnect();
      setServerUrl(undefined);
      setAuthToken(undefined);
      // Revert to mock mode
      simulationApi.init();
      toast({
        title: "Отключено от сервера",
        description: "Вы отключились от сервера. Используются моковые данные."
      });
    } catch (error) {
      console.error("Error disconnecting from server:", error);
      toast({
        title: "Ошибка отключения",
        description: "Произошла ошибка при отключении от сервера",
        variant: "destructive"
      });
    }
  };

  return (
    <SimulationContext.Provider 
      value={{
        isConnected,
        connectionState,
        connectToServer,
        disconnectFromServer,
        connectionError
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

// Custom hook to use the simulation context
export const useSimulation = () => useContext(SimulationContext);
