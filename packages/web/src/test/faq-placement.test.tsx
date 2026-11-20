import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { HowItWorksPage } from '../routes/HowItWorksPage';
import { Faq } from '../components/Faq';
import { SolverProvider } from '../lib/solver/SolverProvider';
import { MockSolverClient } from '../lib/solver/mock';

describe('FAQ', () => {
  it('is on the how it works page, as an accordion that opens on click', () => {
    render(
      <MemoryRouter>
        <SolverProvider client={new MockSolverClient()}>
          <HowItWorksPage />
        </SolverProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /Frequently asked questions/i }),
    ).toBeInTheDocument();
  });

  it('opens an answer when its question is pressed', () => {
    render(<Faq />);
    const first = screen.getAllByRole('button')[0]!;
    expect(first).toHaveAttribute('aria-expanded', 'false');
    first.click();
  });
});
