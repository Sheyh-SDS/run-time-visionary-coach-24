import { webSocketService } from './websocket';
import { 
  Athlete, 
  RunSession, 
  SimulationSettings, 
  ProbabilityAnalysis, 
  RaceResult,
  LiveRaceData,
  TopNProbability,
  PositionProbability
} from '@/types';
import { 
  mockAthletes, 
  mockRunSessions, 
  generateRunningSession,
  mockProbabilityAnalysis,
  calculateProbability,
  mockRaceResults,
  generateRaceWithCompetitors,
  calculateTopNProbability,
  mockTopNProbabilities,
  mockLiveRaceData
} from '@/data/mockData';

export const SIMULATION_MESSAGES = {
  REQUEST_SIMULATION: 'request_simulation',
  SIMULATION_RESULT: 'simulation_result',
  REQUEST_ATHLETES: 'request_athletes',
  ATHLETES_LIST: 'athletes_list',
  REQUEST_SESSIONS: 'request_sessions',
  SESSIONS_LIST: 'sessions_list',
  REQUEST_RACE_RESULTS: 'request_race_results',
  RACE_RESULTS: 'race_results',
  REQUEST_LIVE_RACE: 'request_live_race',
  LIVE_RACE_UPDATE: 'live_race_update',
  REQUEST_PROBABILITIES: 'request_probabilities',
  PROBABILITY_RESULTS: 'probability_results',
  ERROR: 'error'
};

const MOCK_DELAY = 800;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class Cache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  set<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

class SimulationApi {
  private isConnected: boolean = false;
  private mockMode: boolean = true;
  private cache: Cache = new Cache();
  private liveRaceInterval: NodeJS.Timeout | null = null;
  private liveRaceCallbacks = new Set<(data: LiveRaceData) => void>();
  private authToken: string | undefined;

  init(wsUrl?: string, authToken?: string): void {
    this.authToken = authToken;
    
    if (wsUrl) {
      webSocketService.on(SIMULATION_MESSAGES.SIMULATION_RESULT, this.handleSimulationResult);
      webSocketService.on(SIMULATION_MESSAGES.ATHLETES_LIST, this.handleAthletesList);
      webSocketService.on(SIMULATION_MESSAGES.SESSIONS_LIST, this.handleSessionsList);
      webSocketService.on(SIMULATION_MESSAGES.RACE_RESULTS, this.handleRaceResults);
      webSocketService.on(SIMULATION_MESSAGES.LIVE_RACE_UPDATE, this.handleLiveRaceUpdate);
      webSocketService.on(SIMULATION_MESSAGES.PROBABILITY_RESULTS, this.handleProbabilityResults);
      webSocketService.on(SIMULATION_MESSAGES.ERROR, this.handleError);
      
      webSocketService.connect(wsUrl, authToken);
      
      webSocketService.onStateChange((state) => {
        this.isConnected = state === 'open';
        
        if (state === 'open') {
          this.cache.invalidateAll();
        }
      });
      
      this.mockMode = false;
    } else {
      this.mockMode = true;
      this.authToken = undefined;
    }
  }

  private handleSimulationResult = (payload: any) => {
    console.log('Received simulation result:', payload);
    
    try {
      if (this.simulationCallbacks.size > 0) {
        const runSession = payload as RunSession;
        this.simulationCallbacks.forEach(callback => callback(runSession));
      }
    } catch (error) {
      console.error('Error processing simulation result:', error);
    }
  };

  private handleAthletesList = (payload: any) => {
    console.log('Received athletes list:', payload);
    try {
      if (Array.isArray(payload)) {
        this.cache.set('athletes', payload);
      }
    } catch (error) {
      console.error('Error processing athletes list:', error);
    }
  };

  private handleSessionsList = (payload: any) => {
    console.log('Received sessions list:', payload);
    try {
      if (Array.isArray(payload.sessions) && payload.athleteId) {
        this.cache.set(`sessions_${payload.athleteId}`, payload.sessions);
      } else if (Array.isArray(payload)) {
        this.cache.set('sessions', payload);
      }
    } catch (error) {
      console.error('Error processing sessions list:', error);
    }
  };

  private handleRaceResults = (payload: any) => {
    console.log('Received race results:', payload);
    try {
      if (this.raceResultsCallbacks.size > 0) {
        this.raceResultsCallbacks.forEach(callback => callback(payload));
      }
      
      if (payload.raceId) {
        this.cache.set(`race_${payload.raceId}`, payload);
      }
    } catch (error) {
      console.error('Error processing race results:', error);
    }
  };

  private handleLiveRaceUpdate = (payload: LiveRaceData) => {
    console.log('Received live race update:', payload);
    try {
      if (this.liveRaceCallbacks.size > 0) {
        this.liveRaceCallbacks.forEach(callback => callback(payload));
      }
    } catch (error) {
      console.error('Error processing live race update:', error);
    }
  };

  private handleProbabilityResults = (payload: any) => {
    console.log('Received probability results:', payload);
    try {
      if (payload.athleteId && payload.distance) {
        this.cache.set(`probability_${payload.athleteId}_${payload.distance}`, payload);
      }
      
      if (this.probabilityCallbacks.size > 0) {
        this.probabilityCallbacks.forEach(callback => callback(payload));
      }
    } catch (error) {
      console.error('Error processing probability results:', error);
    }
  };

  private handleError = (payload: any) => {
    console.error('Received error from simulation server:', payload);
  };

  getAthletes = async (): Promise<Athlete[]> => {
    const cachedAthletes = this.cache.get<Athlete[]>('athletes');
    if (cachedAthletes) {
      console.log('Using cached athletes data');
      return cachedAthletes;
    }
    
    if (!this.mockMode && this.isConnected) {
      webSocketService.send(SIMULATION_MESSAGES.REQUEST_ATHLETES, {});
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const data = mockAthletes;
          this.cache.set('athletes', data);
          resolve(data);
        } catch (error) {
          console.error('Error getting athletes:', error);
          reject(new Error('Failed to fetch athletes data'));
        }
      }, MOCK_DELAY);
    });
  }

  async getSessions(athleteId?: string): Promise<RunSession[]> {
    const cacheKey = athleteId ? `sessions_${athleteId}` : 'sessions';
    const cachedSessions = this.cache.get<RunSession[]>(cacheKey);
    if (cachedSessions) {
      console.log(`Using cached sessions data for ${cacheKey}`);
      return cachedSessions;
    }
    
    if (!this.mockMode && this.isConnected) {
      webSocketService.send(SIMULATION_MESSAGES.REQUEST_SESSIONS, { athleteId });
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const filteredSessions = athleteId 
            ? mockRunSessions.filter(session => session.athleteId === athleteId)
            : mockRunSessions;
          this.cache.set(cacheKey, filteredSessions);
          resolve(filteredSessions);
        } catch (error) {
          console.error('Error getting sessions:', error);
          reject(new Error('Failed to fetch sessions data'));
        }
      }, MOCK_DELAY);
    });
  }

  private simulationCallbacks = new Set<(session: RunSession) => void>();
  private raceResultsCallbacks = new Set<(results: RaceResult[]) => void>();
  private probabilityCallbacks = new Set<(analysis: ProbabilityAnalysis) => void>();

  onSimulationResult(callback: (session: RunSession) => void): () => void {
    this.simulationCallbacks.add(callback);
    return () => {
      this.simulationCallbacks.delete(callback);
    };
  }

  onRaceResults(callback: (results: RaceResult[]) => void): () => void {
    this.raceResultsCallbacks.add(callback);
    return () => {
      this.raceResultsCallbacks.delete(callback);
    };
  }

  onLiveRaceUpdate(callback: (data: LiveRaceData) => void): () => void {
    this.liveRaceCallbacks.add(callback);
    return () => {
      this.liveRaceCallbacks.delete(callback);
    };
  }

  onProbabilityResults(callback: (analysis: ProbabilityAnalysis) => void): () => void {
    this.probabilityCallbacks.add(callback);
    return () => {
      this.probabilityCallbacks.delete(callback);
    };
  }

  async requestSimulation(
    athleteId: string, 
    settings: SimulationSettings
  ): Promise<RunSession> {
    if (!this.mockMode && this.isConnected) {
      webSocketService.send(SIMULATION_MESSAGES.REQUEST_SIMULATION, {
        athleteId,
        settings
      });
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Simulation request timed out'));
        }, 30000);
        
        const handleResult = (result: RunSession) => {
          if (result.athleteId === athleteId) {
            cleanup();
            resolve(result);
          }
        };
        
        const unsubscribe = this.onSimulationResult(handleResult);
        
        const cleanup = () => {
          clearTimeout(timeout);
          unsubscribe();
        };
      });
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const paceInSecondsPerMeter = (settings.basePace * 60) / 1000;
          const baseTimeForDistance = paceInSecondsPerMeter * settings.distance;
          
          let adjustedTime = baseTimeForDistance;
          
          if (settings.terrainType === 'road') adjustedTime *= 1.02;
          else if (settings.terrainType === 'trail') adjustedTime *= 1.1;
          else if (settings.terrainType === 'hills') adjustedTime *= 1.15;
          
          if (settings.weatherConditions === 'moderate') adjustedTime *= 1.03;
          else if (settings.weatherConditions === 'challenging') adjustedTime *= 1.08;
          else if (settings.weatherConditions === 'extreme') adjustedTime *= 1.15;
          else if (settings.weatherConditions === 'ideal') adjustedTime *= 0.98;
          
          adjustedTime *= (1 - (settings.competitionFactor * 0.05));
          
          const simulatedSession = generateRunningSession(
            athleteId,
            settings.distance,
            adjustedTime,
            settings.variability
          );
          
          this.cache.invalidate(`sessions_${athleteId}`);
          
          resolve(simulatedSession);
        } catch (error) {
          console.error('Error generating simulation:', error);
          reject(new Error('Failed to simulate run session'));
        }
      }, MOCK_DELAY * 2);
    });
  }

  async getProbabilityAnalysis(
    athleteId: string,
    distance: number,
    targetTime: number
  ): Promise<ProbabilityAnalysis | null> {
    const cacheKey = `probability_${athleteId}_${distance}_${targetTime}`;
    const cachedAnalysis = this.cache.get<ProbabilityAnalysis>(cacheKey);
    if (cachedAnalysis) {
      console.log('Using cached probability analysis');
      return cachedAnalysis;
    }
    
    if (!this.mockMode && this.isConnected) {
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const athlete = mockAthletes.find(a => a.id === athleteId);
          if (!athlete) {
            resolve(null);
            return;
          }
          
          const sessions = mockRunSessions.filter(s => s.athleteId === athleteId);
          
          const analysis = mockProbabilityAnalysis[athleteId] || 
            calculateProbability(athlete, distance, targetTime, sessions);
          
          if (analysis) {
            this.cache.set(cacheKey, analysis);
          }
            
          resolve(analysis);
        } catch (error) {
          console.error('Error calculating probability analysis:', error);
          reject(new Error('Failed to calculate probability analysis'));
        }
      }, MOCK_DELAY);
    });
  }

  async getRaceResults(
    distance: number,
    athleteId?: string
  ): Promise<RaceResult[]> {
    const cacheKey = `race_results_${distance}_${athleteId || 'all'}`;
    const cachedResults = this.cache.get<RaceResult[]>(cacheKey);
    if (cachedResults) {
      console.log('Using cached race results');
      return cachedResults;
    }
    
    if (!this.mockMode && this.isConnected) {
      webSocketService.send(SIMULATION_MESSAGES.REQUEST_RACE_RESULTS, {
        distance,
        athleteId
      });
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Race results request timed out'));
        }, 30000);
        
        const handleResult = (results: RaceResult[]) => {
          cleanup();
          resolve(results);
        };
        
        const unsubscribe = this.onRaceResults(handleResult);
        
        const cleanup = () => {
          clearTimeout(timeout);
          unsubscribe();
        };
      });
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          let results: RaceResult[];
          
          if (athleteId) {
            const athlete = mockAthletes.find(a => a.id === athleteId);
            if (!athlete) {
              reject(new Error('Athlete not found'));
              return;
            }
            
            results = generateRaceWithCompetitors(athlete, distance);
          } else {
            results = mockRaceResults;
          }
          
          this.cache.set(cacheKey, results);
          resolve(results);
        } catch (error) {
          console.error('Error getting race results:', error);
          reject(new Error('Failed to get race results'));
        }
      }, MOCK_DELAY);
    });
  }

  async getTopNProbabilities(
    athleteId: string,
    distance: number,
    topN: number[][]
  ): Promise<TopNProbability[]> {
    const cacheKey = `top_n_${athleteId}_${distance}_${topN.map(n => n.join('-')).join('_')}`;
    const cachedResults = this.cache.get<TopNProbability[]>(cacheKey);
    if (cachedResults) {
      console.log('Using cached top-N probabilities');
      return cachedResults;
    }
    
    if (!this.mockMode && this.isConnected) {
    }
    
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const analysis = mockProbabilityAnalysis[athleteId];
          if (!analysis || !analysis.positionProbabilities) {
            resolve(mockTopNProbabilities);
            return;
          }
          
          const positionProbabilities = analysis.positionProbabilities;
          const results: TopNProbability[] = topN.map(positions => ({
            topN: positions,
            probability: calculateTopNProbability(positionProbabilities, positions)
          }));
          
          this.cache.set(cacheKey, results);
          resolve(results);
        } catch (error) {
          console.error('Error calculating top-N probabilities:', error);
          reject(new Error('Failed to calculate top-N probabilities'));
        }
      }, MOCK_DELAY);
    });
  }

  startLiveRaceSimulation(distance: number, competitors: string[]): Promise<string> {
    if (!this.mockMode && this.isConnected) {
      webSocketService.send(SIMULATION_MESSAGES.REQUEST_LIVE_RACE, {
        distance,
        competitors
      });
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Live race request timed out'));
        }, 10000);
        
        const handleLiveRace = (data: LiveRaceData) => {
          if (data.status === 'starting' || data.status === 'running') {
            cleanup();
            resolve(data.raceId);
          }
        };
        
        const unsubscribe = this.onLiveRaceUpdate(handleLiveRace);
        
        const cleanup = () => {
          clearTimeout(timeout);
          unsubscribe();
        };
      });
    }
    
    return new Promise((resolve) => {
      setTimeout(() => {
        this.stopLiveRaceSimulation();
        
        const liveRace = JSON.parse(JSON.stringify(mockLiveRaceData));
        
        liveRace.distance = distance;
        liveRace.status = 'starting';
        liveRace.elapsedTime = 0;
        
        if (competitors.length > 0) {
          liveRace.athletes = liveRace.athletes.filter(a => 
            competitors.includes(a.athleteId)
          );
        }
        
        liveRace.athletes.forEach((a, index) => {
          a.currentPosition = index + 1;
          a.currentDistance = 0;
          a.splitTimes = [];
        });
        
        if (this.liveRaceCallbacks.size > 0) {
          this.liveRaceCallbacks.forEach(callback => callback(liveRace));
        }
        
        setTimeout(() => {
          liveRace.status = 'running';
          
          this.liveRaceInterval = setInterval(() => {
            liveRace.elapsedTime += 0.1;
            
            liveRace.athletes.forEach(athlete => {
              let speed;
              const accPhase = 2.0;
              
              if (liveRace.elapsedTime < accPhase) {
                const athleteData = mockAthletes.find(a => a.id === athlete.athleteId);
                const acc = athleteData?.acceleration || 5;
                speed = acc * liveRace.elapsedTime;
              } else {
                const athleteData = mockAthletes.find(a => a.id === athlete.athleteId);
                const maxSpeed = athleteData?.maxSpeed || 9;
                speed = maxSpeed + (Math.random() * 0.2) - 0.1;
              }
              
              athlete.currentDistance += speed * 0.1;
              athlete.currentSpeed = speed;
              
              if (Math.floor(athlete.currentDistance / 20) > athlete.splitTimes.length) {
                athlete.splitTimes.push(liveRace.elapsedTime);
              }
              
              if (athlete.currentDistance >= distance) {
                athlete.currentDistance = distance;
                athlete.currentSpeed = 0;
              }
            });
            
            liveRace.athletes.sort((a, b) => b.currentDistance - a.currentDistance);
            liveRace.athletes.forEach((athlete, index) => {
              athlete.currentPosition = index + 1;
            });
            
            if (liveRace.athletes.every(a => a.currentDistance >= distance)) {
              liveRace.status = 'finished';
              this.stopLiveRaceSimulation();
              
              const results: RaceResult[] = liveRace.athletes.map(a => ({
                position: a.currentPosition,
                number: a.number,
                athleteId: a.athleteId,
                athleteName: a.name,
                jerseyColor: a.jerseyColor,
                time: liveRace.elapsedTime,
                difference: 0
              }));
              
              const winnerTime = results[0].time;
              results.forEach(r => {
                r.difference = parseFloat((r.time - winnerTime).toFixed(2));
              });
              
              this.cache.set(`race_${liveRace.raceId}`, results);
            }
            
            if (this.liveRaceCallbacks.size > 0) {
              this.liveRaceCallbacks.forEach(callback => callback(liveRace));
            }
          }, 100);
        }, 1000);
        
        resolve(liveRace.raceId);
      }, MOCK_DELAY);
    });
  }

  stopLiveRaceSimulation() {
    if (this.liveRaceInterval) {
      clearInterval(this.liveRaceInterval);
      this.liveRaceInterval = null;
    }
  }
}

export const simulationApi = new SimulationApi();

simulationApi.init();

export function connectToSimulationServer(wsUrl: string, authToken?: string) {
  simulationApi.init(wsUrl, authToken);
}

export function connectToUnitySimulation(unityInstance: any) {
  webSocketService.connectToUnitySimulation(unityInstance);
}
