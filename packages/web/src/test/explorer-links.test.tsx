import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TxLink } from '../components/TxLink';
import { bchTxUrl, chainLabel, evmTxUrl } from '../lib/explorer';

const HASH = 'ab'.repeat(32);

describe('explorer links', () => {
  it('builds the page of a transaction on each chain', () => {
    expect(evmTxUrl(8453, `0x${HASH}`)).toBe(
      `https://basescan.org/tx/0x${HASH}`,
    );
    expect(evmTxUrl(8453, HASH)).toBe(`https://basescan.org/tx/0x${HASH}`);
    expect(evmTxUrl(4663, `0x${HASH}`)).toBe(
      `https://robinhoodchain.blockscout.com/tx/0x${HASH}`,
    );
    expect(evmTxUrl(999999, HASH)).toBeNull();
    expect(bchTxUrl(`0x${HASH}`)).toBe(`https://bchexplorer.info/tx/${HASH}`);
  });

  it('shows a transaction as a link, and as plain text when no explorer is known', () => {
    const { rerender } = render(
      <TxLink label="Your lock" hash={HASH} url={bchTxUrl(HASH)} />,
    );
    expect(screen.getByTestId('tx-link').getAttribute('href')).toBe(
      `https://bchexplorer.info/tx/${HASH}`,
    );
    rerender(<TxLink label="Your lock" hash={HASH} url={null} />);
    expect(screen.queryByTestId('tx-link')).toBeNull();
  });

  it('labels EVM chains by name and Bitcoin Cash by nothing', () => {
    expect(chainLabel('Chain 8453')).toBe('Base');
    expect(chainLabel('Chain 4663')).toBe('Robinhood Chain');
    expect(chainLabel('Bitcoin Cash')).toBeNull();
    expect(chainLabel('Chain 999')).toBe('Chain 999');
  });
});
