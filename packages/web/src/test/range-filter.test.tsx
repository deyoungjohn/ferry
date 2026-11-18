import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Footer, isInternalPath } from '../components/Footer';
import {
  RangeFilter,
  filterByRange,
  localToSeconds,
  rangeBounds,
  type RangeValue,
} from '../components/ui/range-filter';

const NOW = 1_800_000_000;
const DAY = 86_400;

describe('time range windows', () => {
  const items = [
    { id: 'h', at: NOW - 3600 },
    { id: 'd3', at: NOW - 3 * DAY },
    { id: 'd20', at: NOW - 20 * DAY },
    { id: 'd60', at: NOW - 60 * DAY },
    { id: 'd120', at: NOW - 120 * DAY },
  ];
  const ids = (value: RangeValue) =>
    filterByRange(items, (item) => item.at, value, NOW).map((item) => item.id);

  it('keeps what falls inside each preset and nothing older', () => {
    expect(ids({ kind: '24h' })).toEqual(['h']);
    expect(ids({ kind: '7d' })).toEqual(['h', 'd3']);
    expect(ids({ kind: '30d' })).toEqual(['h', 'd3', 'd20']);
    expect(ids({ kind: '90d' })).toEqual(['h', 'd3', 'd20', 'd60']);
  });

  it('keeps exactly the custom window, both ends included', () => {
    expect(
      ids({ kind: 'custom', from: NOW - 20 * DAY, to: NOW - 3 * DAY }),
    ).toEqual(['d3', 'd20']);
    expect(rangeBounds({ kind: 'custom', from: 5, to: 9 }, NOW)).toEqual({
      from: 5,
      to: 9,
    });
  });

  it('reads a date and a time in the viewer local zone', () => {
    const noon = localToSeconds('2026-11-18', '12:00');
    const evening = localToSeconds('2026-11-18', '18:30');
    expect(evening - noon).toBe(6.5 * 3600);
  });

  it('the control sets a preset when a chip is chosen', () => {
    let chosen: RangeValue = { kind: '90d' };
    render(
      <RangeFilter value={chosen} onChange={(value) => (chosen = value)} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '7d' }));
    expect(chosen).toEqual({ kind: '7d' });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });
});

describe('the big name is for the public pages', () => {
  it('knows which paths are inside the product', () => {
    for (const path of ['/app/swap', '/app', '/pay/abc', '/send/abc']) {
      expect(isInternalPath(path)).toBe(true);
    }
    for (const path of ['/', '/features', '/stats', '/status', '/user-guide']) {
      expect(isInternalPath(path)).toBe(false);
    }
  });

  it('shows the wordmark on a public page and not in the app', () => {
    const view = (path: string) => (
      <MemoryRouter initialEntries={[path]}>
        <Footer />
      </MemoryRouter>
    );
    const { container, unmount } = render(view('/features'));
    expect(container.querySelector('p[aria-hidden="true"]')).not.toBeNull();
    unmount();
    const app = render(view('/app/swap'));
    expect(app.container.querySelector('p[aria-hidden="true"]')).toBeNull();
  });
});
