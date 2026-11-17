import { useMemo, type ReactNode } from 'react';
import type { SolverClient } from './types';
import { SolverContext } from './context';
import { RealSolverClient } from './real';
import { MockSolverClient } from '../solver/mock';

export interface SolverProviderProps {
  readonly client?: SolverClient;
  readonly children: ReactNode;
}

function getDefaultSolverClient(): SolverClient {
  if (
    typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_MOCK === '1' ||
      import.meta.env?.VITE_USE_MOCKS === '1')
  ) {
    return new MockSolverClient();
  }
  return new RealSolverClient();
}

export function SolverProvider({ client, children }: SolverProviderProps) {
  const solver = useMemo(() => client ?? getDefaultSolverClient(), [client]);

  return (
    <SolverContext.Provider value={solver}>{children}</SolverContext.Provider>
  );
}
