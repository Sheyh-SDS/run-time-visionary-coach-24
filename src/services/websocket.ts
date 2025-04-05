import { toast } from "@/hooks/use-toast";

// WebSocket connection states
export type WebSocketState = 'connecting' | 'open' | 'closed' | 'error';

// WebSocket message types
export interface WebSocketMessage {
  type: string;
  payload: any;
}

class WebSocketService {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private messageHandlers: Record<string, ((payload: any) => void)[]> = {};
  private stateChangeHandlers: ((state: WebSocketState) => void)[] = [];
  private authToken: string | undefined;

  // Connect to WebSocket server
  connect(url: string, authToken?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    // Save the auth token
    this.authToken = authToken;
    
    try {
      console.log(`Connecting to WebSocket server at ${url}`);
      
      let finalUrl = url;
      // Если токен предоставлен, добавляем его как параметр запроса
      if (authToken) {
        const separator = url.includes('?') ? '&' : '?';
        finalUrl = `${url}${separator}token=${encodeURIComponent(authToken)}`;
        console.log(`Auth token provided, connecting with token`);
      }
      
      this.socket = new WebSocket(finalUrl);
      this.registerSocketListeners();
      this.notifyStateChange('connecting');
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.notifyStateChange('error');
      toast({
        title: "Ошибка подключения",
        description: "Не удалось установить WebSocket соединение.",
        variant: "destructive"
      });
      this.attemptReconnect();
    }
  }

  // Register WebSocket event listeners
  private registerSocketListeners(): void {
    if (!this.socket) return;

    this.socket.onopen = (event) => {
      console.log('WebSocket connection established');
      this.reconnectAttempts = 0;
      this.notifyStateChange('open');
      
      // If we have an auth token, send authentication message
      if (this.authToken) {
        this.send('authenticate', { token: this.authToken });
        console.log('Authentication message sent');
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('Received message:', message);
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.socket.onclose = (event) => {
      console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
      this.notifyStateChange('closed');
      
      if (!event.wasClean) {
        this.attemptReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.notifyStateChange('error');
    };
  }

  // Handle incoming messages
  private handleMessage(message: WebSocketMessage): void {
    const { type, payload } = message;
    const handlers = this.messageHandlers[type] || [];
    const wildcardHandlers = this.messageHandlers['*'] || [];
    
    console.log(`Received WebSocket message of type: ${type}`);
    
    if (handlers.length === 0 && wildcardHandlers.length === 0) {
      console.warn(`No handlers registered for message type: ${type}`);
    }

    // Call specific handlers for this message type
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Error in handler for message type ${type}:`, error);
      }
    });

    // Also call wildcard handlers
    wildcardHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error in wildcard handler for message type ${type}:`, error);
      }
    });
  }

  // Attempt to reconnect to WebSocket server
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      toast({
        title: "Ошибка соединения",
        description: "Не удалось подключиться к серверу симуляции после нескольких попыток.",
        variant: "destructive"
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      if (this.socket?.url) {
        this.connect(this.socket.url);
      }
    }, delay);
  }

  // Send a message to the WebSocket server
  send(type: string, payload: any): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message, WebSocket is not connected');
      return false;
    }

    try {
      const message: WebSocketMessage = { type, payload };
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }

  // Register a handler for a specific message type
  on(type: string, handler: (payload: any) => void): () => void {
    if (!this.messageHandlers[type]) {
      this.messageHandlers[type] = [];
    }
    
    this.messageHandlers[type].push(handler);
    
    // Return a function to unregister this handler
    return () => {
      this.messageHandlers[type] = this.messageHandlers[type].filter(h => h !== handler);
    };
  }

  // Register a state change handler
  onStateChange(handler: (state: WebSocketState) => void): () => void {
    this.stateChangeHandlers.push(handler);
    
    // Return a function to unregister this handler
    return () => {
      this.stateChangeHandlers = this.stateChangeHandlers.filter(h => h !== handler);
    };
  }

  // Notify all state change handlers
  private notifyStateChange(state: WebSocketState): void {
    this.stateChangeHandlers.forEach(handler => {
      try {
        handler(state);
      } catch (error) {
        console.error('Error in WebSocket state change handler:', error);
      }
    });
  }

  // Disconnect from WebSocket server
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    // Clear the auth token when disconnecting
    this.authToken = undefined;
  }

  // Get current WebSocket state
  getState(): WebSocketState {
    if (!this.socket) return 'closed';
    
    switch (this.socket.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'open';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return 'closed';
    }
  }

  // Support for Unity WebGL based simulations
  connectToUnitySimulation(unityInstance: any): void {
    // Method to be called when Unity is loaded and ready
    // The unityInstance would be the reference to the Unity WebGL instance
    
    if (!unityInstance) {
      console.error('Unity instance is not provided');
      return;
    }
    
    try {
      // Register a method to receive data from Unity
      // This assumes Unity will call this method via JSLib
      window.receiveFromUnity = (jsonData: string) => {
        try {
          const data = JSON.parse(jsonData);
          this.handleMessage({
            type: data.type || 'unity_message',
            payload: data
          });
        } catch (error) {
          console.error('Error parsing data from Unity:', error);
        }
      };
      
      console.log('Unity simulation connection established');
      toast({
        title: "Подключено к Unity",
        description: "Соединение с симуляцией Unity установлено."
      });
      
    } catch (error) {
      console.error('Error connecting to Unity simulation:', error);
      toast({
        title: "Ошибка подключения",
        description: "Не удалось подключиться к симуляции Unity.",
        variant: "destructive"
      });
    }
  }
  
  // Send data to Unity
  sendToUnity(method: string, data: any): boolean {
    try {
      if (window.unityInstance) {
        const stringData = JSON.stringify(data);
        window.unityInstance.SendMessage('WebSocketReceiver', method, stringData);
        return true;
      } else {
        console.warn('Unity instance not available');
        return false;
      }
    } catch (error) {
      console.error('Error sending data to Unity:', error);
      return false;
    }
  }
}

// Create singleton instance
export const webSocketService = new WebSocketService();

// Add global types for Unity integration
declare global {
  interface Window {
    receiveFromUnity: (jsonData: string) => void;
    unityInstance: any;
  }
}
