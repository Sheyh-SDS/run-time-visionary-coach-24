
import { useState, useEffect, useCallback, useRef } from 'react';
import { webSocketService, WebSocketState, WebSocketMessage } from '@/services/websocket';

interface UseWebSocketOptions {
  url?: string;
  reconnectOnMount?: boolean;
  onMessage?: (message: WebSocketMessage) => void;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  authToken?: string; // Добавляем опцию для авторизационного токена
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connectionState, setConnectionState] = useState<WebSocketState>(
    webSocketService.getState()
  );
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const {
    maxReconnectAttempts = 5,
    reconnectInterval = 3000,
    onMessage,
    authToken
  } = options;

  // Setup message handler if provided
  useEffect(() => {
    let messageUnsubscribe: (() => void) | undefined;
    
    if (onMessage) {
      // Use the 'on' method to register a general message handler for all message types
      messageUnsubscribe = webSocketService.on('*', (payload) => {
        onMessage({ type: payload.type || 'unknown', payload: payload.payload });
      });
    }
    
    return () => {
      if (messageUnsubscribe) {
        messageUnsubscribe();
      }
    };
  }, [onMessage]);

  // Register state change handler
  useEffect(() => {
    const unsubscribeState = webSocketService.onStateChange((state) => {
      setConnectionState(state);
      
      // Reset reconnect attempts when connected successfully
      if (state === 'open') {
        reconnectAttemptsRef.current = 0;
      }
      
      // Attempt to reconnect on error
      if (state === 'error' || state === 'closed') {
        attemptReconnect();
      }
    });

    // Attempt reconnect logic
    const attemptReconnect = () => {
      // Clear any existing reconnect timer
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      
      // If we've exceeded max attempts, give up
      if (reconnectAttemptsRef.current >= maxReconnectAttempts || !options.url) {
        console.log(`Max reconnect attempts (${maxReconnectAttempts}) reached or no URL provided.`);
        return;
      }
      
      // Exponential backoff
      const delay = reconnectInterval * Math.pow(1.5, reconnectAttemptsRef.current);
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})...`);
      
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectAttemptsRef.current += 1;
        if (options.url) {
          console.log(`Reconnecting to ${options.url}...`);
          webSocketService.connect(options.url, authToken);
        }
      }, delay);
    };

    // Connect if URL is provided and reconnectOnMount is true
    if (options.url && options.reconnectOnMount) {
      webSocketService.connect(options.url, authToken);
    }

    // Cleanup on unmount
    return () => {
      unsubscribeState();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [options.url, options.reconnectOnMount, maxReconnectAttempts, reconnectInterval, authToken]);

  // Helper to send a message
  const sendMessage = useCallback((type: string, payload: any): boolean => {
    return webSocketService.send(type, payload);
  }, []);

  // Helper to register a message handler
  const onMessageType = useCallback((type: string, handler: (payload: any) => void): () => void => {
    return webSocketService.on(type, handler);
  }, []);

  // Connect to WebSocket server
  const connect = useCallback((url?: string, token?: string) => {
    if (url || options.url) {
      reconnectAttemptsRef.current = 0;
      webSocketService.connect(url || options.url || '', token || authToken);
    } else {
      console.error('No WebSocket URL provided');
    }
  }, [options.url, authToken]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    // Stop any reconnection attempts
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    webSocketService.disconnect();
  }, []);

  return {
    connectionState,
    isConnected: connectionState === 'open',
    isConnecting: connectionState === 'connecting',
    sendMessage,
    onMessage: onMessageType,
    connect,
    disconnect
  };
}
