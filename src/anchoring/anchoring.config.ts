export interface AnchoringConfigOptions {
  batchSizeThreshold: number;
  timeIntervalMinutes: number;
  maxBatchSize: number;
  minIntervalMinutes: number;
  balanceFloor: number;
}

export const defaultAnchoringConfig: AnchoringConfigOptions = {
  batchSizeThreshold: 50,
  timeIntervalMinutes: 15,
  maxBatchSize: 500,
  minIntervalMinutes: 2,
  balanceFloor: 10.0,
};
