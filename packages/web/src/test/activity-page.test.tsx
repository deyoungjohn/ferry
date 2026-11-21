import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest';
import { MemoryRouter } from 'react-router';
import { ActivityPage, ACTIVITY_PAGE_SIZE } from '../routes/ActivityPage';
import { getMockActivity } from '../lib/activity/mock';

/** The fixtures are dated 14 Nov 2024; pin the clock so the default 90-day window includes them. */
const FIXTURE_NOW = new Date('2024-11-15T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe('ActivityPage (/activity) - BCH-first history (FR-13)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders My Activity header and address inspection input', () => {
    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: /My Activity/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Bitcoin Cash Address/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Inspect Address/i }),
    ).toBeInTheDocument();
  });

  it('renders paginated table with 10 rows per page', () => {
    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>,
    );

    expect(ACTIVITY_PAGE_SIZE).toBe(10);
    const table = screen.getByRole('table', { name: /Swap Activity Table/i });
    expect(table).toBeInTheDocument();

    const mockTotal = getMockActivity().length;
    expect(mockTotal).toBeGreaterThan(10);

    // Initial page shows 10 rows in tbody
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBe(10);

    // Next page button exists
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    expect(nextBtn).toBeInTheDocument();
    fireEvent.click(nextBtn);

    // Page 2 shows remaining rows
    expect(screen.getByText(/Page 2 of/i)).toBeInTheDocument();
  });

  it('validates CashAddress format on inspect submit', async () => {
    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/Bitcoin Cash Address/i);
    const submitBtn = screen.getByRole('button', { name: /Inspect Address/i });

    // Submit invalid address
    fireEvent.change(input, { target: { value: 'not-a-valid-cashaddr' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Invalid CashAddress/i)).toBeInTheDocument();
    });

    // Submit valid chipnet cashaddr
    fireEvent.change(input, {
      target: {
        value:
          'bchtest:rv3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy5ghlh3cy',
      },
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(/Active address:/i)).toBeInTheDocument();
    });
  });

  it('copies transaction hash when copy button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>,
    );

    const copyButtons = screen.getAllByTitle(/Copy/i);
    expect(copyButtons.length).toBeGreaterThan(0);

    fireEvent.click(copyButtons[0]!);
    expect(writeTextMock).toHaveBeenCalled();
  });
});

describe('ActivityPage with an offline, remembered Bitcoin Cash wallet', () => {
  it('does not show the remembered address as the connected wallet', async () => {
    const { WalletContext } = await import('../lib/wallet/context');
    const remembered = 'bitcoincash:zplzkjj2qj7u66w3aqggxw4d392elac005qk68ff65';
    const value = {
      usingMocks: false,
      evm: {
        status: 'connected',
        address: '0x1111111111111111111111111111111111111111',
      },
      bch: {
        status: 'offline',
        address: {
          address: remembered,
          lockingBytecode: '0x00',
          tokenAware: true,
        },
      },
    } as unknown as React.ContextType<typeof WalletContext>;
    render(
      <MemoryRouter>
        <WalletContext.Provider value={value}>
          <ActivityPage />
        </WalletContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.queryByText(remembered)).toBeNull();
    expect(screen.queryByText('Connected Wallet')).toBeNull();
    expect(screen.queryByText(/Active address/)).toBeNull();
  });
});
