import { createContext } from 'react';
import type { SolverClient } from './types';

export const SolverContext = createContext<SolverClient | null>(null);
