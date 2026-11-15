import { useMemo, type ReactNode } from 'react';
import type { SolverClient } from './types';
import { SolverContext } from './context';
import { MockSolverClient } from './mock';

export interface SolverProviderProps {
  readonly client?: SolverClient;
  readonly children: ReactNode;
}

export function SolverProvider({ client, children }: SolverProviderProps) {
  const solver = useMemo(() => client ?? new MockSolverClient(), [client]);

  return (
    <SolverContext.Provider value={solver}>{children}</SolverContext.Provider>
  );
}
