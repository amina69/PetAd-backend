export interface StatusStep {
  name: string;
  completed: boolean;
}

export interface StatusResponse {
  current: string;
  steps: StatusStep[];
  nextActions: string[];
  updatedAt: Date;
  isTerminal: boolean;
}
