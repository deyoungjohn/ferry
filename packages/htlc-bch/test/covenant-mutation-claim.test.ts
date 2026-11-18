import { describe, expect, it } from 'vitest';
import {
  runCovenantMutations,
  type TokenName,
} from './support/covenant-mutations.js';

describe.each<TokenName>(['PUSD', 'MUSD'])(
  'FerryHTLC claim spend mutations (%s)',
  (token) => {
    it('rejects every mutation except the documented allowed variants', () => {
      const report = runCovenantMutations('claim', token);
      console.info(
        `claim ${token}: ${report.total} mutations, ${report.rejected} rejected, ${report.allowedAccepted.length} allowed variants accepted`,
      );
      expect(report.unexpectedlyAccepted).toEqual([]);
      expect(report.unexpectedlyRejected).toEqual([]);
      expect(report.total).toBeGreaterThan(200);
    });
  },
);
