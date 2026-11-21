import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { describe, it, expect } from 'vitest';
import { HelpPage } from '../routes/HelpPage';
import { HELP_COPY } from '../lib/copy';

describe('User Guide Page (/help) (Task B3-09)', () => {
  it('renders the user guide title and all expected topics', () => {
    render(
      <BrowserRouter>
        <HelpPage />
      </BrowserRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      HELP_COPY.title,
    );

    // Verify all 6 required topics are present
    expect(
      screen.getByText('Send stablecoins to Bitcoin Cash'),
    ).toBeInTheDocument();
    expect(screen.getByText('Get paid with a pay link')).toBeInTheDocument();
    expect(
      screen.getByText('Send a link to someone on another chain'),
    ).toBeInTheDocument();
    expect(screen.getByText('What if something stalls?')).toBeInTheDocument();
    expect(screen.getByText('What does it cost?')).toBeInTheDocument();
    expect(screen.getByText('Who can see what?')).toBeInTheDocument();
  });

  it('allows expanding and collapsing guide sections with accessible aria attributes', () => {
    render(
      <BrowserRouter>
        <HelpPage />
      </BrowserRouter>,
    );

    const stallsButton = screen.getByRole('button', {
      name: /What if something stalls\?/i,
    });
    expect(stallsButton).toBeInTheDocument();

    // Click to expand
    fireEvent.click(stallsButton);
    expect(stallsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Refund Deadlines:/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/@ferry\/recover-cli/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Click to collapse
    fireEvent.click(stallsButton);
    expect(stallsButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('documents fees with a worked example and exact transparent pricing', () => {
    render(
      <BrowserRouter>
        <HelpPage />
      </BrowserRouter>,
    );

    const costButton = screen.getByRole('button', {
      name: /What does it cost\?/i,
    });
    fireEvent.click(costButton);

    expect(screen.getByText(/5 basis points/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero \(\$0\.00\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Worked Example:/i)).toBeInTheDocument();
  });

  it('documents URL fragment privacy and secret handling', () => {
    render(
      <BrowserRouter>
        <HelpPage />
      </BrowserRouter>,
    );

    const privacyButton = screen.getByRole('button', {
      name: /Who can see what\?/i,
    });
    fireEvent.click(privacyButton);

    expect(screen.getByText(/Secret in URL Fragment:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Web browsers never transmit URL fragments/i),
    ).toBeInTheDocument();
  });
});
