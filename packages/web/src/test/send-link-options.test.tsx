import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { SendLinksPage } from '../routes/SendLinksPage';
import {
  claimWindow,
  customExpiryMs,
  dayOptions,
  defaultCustomExpiry,
} from '../lib/paylink/claim-window';
import { cleanNote, listSendLinks } from '../lib/paylink/send-store';

const NOW = new Date('2026-11-18T10:20:00').getTime();
const HOUR = 3_600_000;

describe('claim window choices', () => {
  it('presets give their fixed window', () => {
    const custom = defaultCustomExpiry(NOW);
    for (const [choice, seconds] of [
      ['24h', 86_400],
      ['3d', 259_200],
      ['7d', 604_800],
    ] as const) {
      const result = claimWindow(choice, custom, NOW);
      expect(result.ok && result.windowSeconds).toBe(seconds);
    }
  });

  it('a custom end sets the window from now to that moment', () => {
    // Day 2, 14:30 local.
    const custom = { dayOffset: 2, hour: 14, minute: 30 };
    const result = claimWindow('custom', custom, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expiresAtMs).toBe(customExpiryMs(custom, NOW));
      expect(result.windowSeconds).toBe(
        Math.floor((customExpiryMs(custom, NOW) - NOW) / 1000),
      );
    }
  });

  it('refuses a custom end under one hour away or over seven days away, in plain words', () => {
    const soon = claimWindow(
      'custom',
      { dayOffset: 0, hour: 10, minute: 50 },
      NOW,
    );
    expect(soon.ok).toBe(false);
    if (!soon.ok) expect(soon.message).toMatch(/at least one hour/i);

    const past = claimWindow(
      'custom',
      { dayOffset: 0, hour: 9, minute: 0 },
      NOW,
    );
    expect(past.ok).toBe(false);

    const far = claimWindow(
      'custom',
      { dayOffset: 7, hour: 23, minute: 55 },
      NOW,
    );
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.message).toMatch(/7 days/);

    const edge = claimWindow(
      'custom',
      { dayOffset: 7, hour: 10, minute: 0 },
      NOW,
    );
    expect(edge.ok).toBe(true);
  });

  it('the first custom choice is already valid', () => {
    const result = claimWindow('custom', defaultCustomExpiry(NOW), NOW);
    expect(result.ok).toBe(true);
    // Late in the evening too: the next whole hour can fall after midnight.
    const late = new Date('2026-11-18T23:40:00').getTime();
    expect(claimWindow('custom', defaultCustomExpiry(late), late).ok).toBe(
      true,
    );
  });

  it('lists today and the seven days after it', () => {
    const days = dayOptions(NOW);
    expect(days).toHaveLength(8);
    expect(days[0]!.label).toBe('Today');
    expect(days[1]!.label).toBe('Tomorrow');
    void HOUR;
  });
});

describe('notes', () => {
  it('are trimmed, empty ones dropped, long ones cut to 140 characters', () => {
    expect(cleanNote('  hello  ')).toBe('hello');
    expect(cleanNote('   ')).toBeUndefined();
    expect(cleanNote('x'.repeat(300))).toHaveLength(140);
  });
});

describe('the send link form', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function fillAndSubmit(address: string) {
    fireEvent.change(document.getElementById('send-dest-address')!, {
      target: { value: address },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Send Link' }));
  }

  it('makes a link with a note and a custom claim window, and keeps both', async () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Claim Window/ }));
    fireEvent.click(
      await screen.findByRole('option', { name: /Custom date and time/ }),
    );
    expect(
      await screen.findByTestId('claim-window-custom'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('claim-window-summary')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Note for the receiver/), {
      target: { value: 'Rent for November' },
    });
    expect(screen.getByTestId('note-count')).toHaveTextContent('17/140');

    fillAndSubmit('0x1111222233334444555566667777888899990000');

    expect(await screen.findByTestId('created-note')).toHaveTextContent(
      'Rent for November',
    );
    await waitFor(() => expect(listSendLinks()).toHaveLength(1));
    const [saved] = listSendLinks();
    expect(saved!.note).toBe('Rent for November');
    // A custom end tomorrow-or-later: longer than a day, shorter than seven.
    expect(saved!.windowSeconds).toBeGreaterThan(86_400 - 60);
    expect(saved!.windowSeconds).toBeLessThan(7 * 86_400);
  });

  it('a link without a note has none', async () => {
    render(
      <MemoryRouter>
        <SendLinksPage />
      </MemoryRouter>,
    );
    fillAndSubmit('0x1111222233334444555566667777888899990000');
    await waitFor(() => expect(listSendLinks()).toHaveLength(1));
    expect(listSendLinks()[0]!.note).toBeUndefined();
    expect(screen.queryByTestId('created-note')).toBeNull();
  });
});
