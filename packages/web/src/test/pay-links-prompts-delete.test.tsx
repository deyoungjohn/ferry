import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PayLinksPage } from '../routes/PayLinksPage';
import {
  listPayLinks,
  removePayLink,
  savePayLink,
} from '../lib/paylink/pay-store';
import type { PayLinkData } from '../lib/paylink/link';

function link(id: string, status: PayLinkData['status']): PayLinkData {
  return {
    id,
    token: 'PUSD',
    recipientAddress: 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65',
    amountOut: 5,
    status,
    createdAt: 1_790_000_000,
  } as unknown as PayLinkData;
}

describe('pay links: missing-detail prompt and delete', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('the button stays clickable and a yellow prompt names the missing address', () => {
    render(
      <MemoryRouter>
        <PayLinksPage />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: /Generate Pay Link/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(screen.getByTestId('missing-detail').textContent).toMatch(
      /Enter the Bitcoin Cash address/i,
    );
  });

  it('removes an unpaid link and keeps a paid one', () => {
    savePayLink(link('unpaid-1', 'open'));
    savePayLink(link('paid-1', 'paid'));
    expect(removePayLink('paid-1')).toBe(false);
    expect(removePayLink('unpaid-1')).toBe(true);
    expect(listPayLinks().map((l) => l.id)).toEqual(['paid-1']);
  });
});
