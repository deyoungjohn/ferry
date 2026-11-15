import { useContext } from 'react';
import type { SolverClient } from './types';
import { SolverContext } from './context';

export function useSolver(): SolverClient {
  const context = useContext(SolverContext);
  if (!context) {
    throw new Error('useSolver must be used within a SolverProvider');
  }
  return context;
}
