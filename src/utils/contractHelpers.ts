import { EXPLORER_BASE } from '../appConfig';

export function buildExplorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

export function buildExplorerAddrUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}

/** Circle state enum from contract */
export enum CircleState {
  Pending = 0,
  Active = 1,
  Finished = 2,
}

export function stateName(state: number): string {
  if (state === (CircleState.Pending as number)) return 'Waiting';
  if (state === (CircleState.Active as number)) return 'Active';
  return 'Finished';
}
