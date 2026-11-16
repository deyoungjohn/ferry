import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BannerBar } from '../components/BannerBar';
import { getBannerWarnings, type BannerConfig } from '../lib/config';

describe('BannerBar and build warnings', () => {
  it('displays a visible build warning when configuration values are unset', () => {
    render(<BannerBar />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      /Build warning: Banner configuration incomplete/i,
    );
    expect(screen.getByText('not set')).toBeInTheDocument();
  });

  it('detects all required unset properties in getBannerWarnings (priorDemoUrl is optional)', () => {
    const emptyConfig: BannerConfig = {
      deckUrl: '',
      repoUrl: '',
      emberAddress: '',
      priorRepoUrl: '',
      priorDemoUrl: '',
    };
    const warnings = getBannerWarnings(emptyConfig);
    expect(warnings).toHaveLength(4);
    expect(warnings).toContain('Deck URL is unset');
    expect(warnings).toContain('Repo URL is unset');
    expect(warnings).toContain('EMBER2026 address is unset');
    expect(warnings).toContain('Prior repo URL is unset');
    expect(warnings).not.toContain('Prior demo URL is unset');
  });

  it('returns no warnings when all required properties are provided and priorDemoUrl is empty', () => {
    const configWithoutDemo: BannerConfig = {
      deckUrl: 'https://example.com/deck',
      repoUrl: 'https://github.com/deyoungjohn/ferry',
      emberAddress: 'bchtest:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      priorRepoUrl: 'https://github.com/example/prior',
      priorDemoUrl: '',
    };
    const warnings = getBannerWarnings(configWithoutDemo);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when all properties are provided', () => {
    const fullConfig: BannerConfig = {
      deckUrl: 'https://example.com/deck',
      repoUrl: 'https://github.com/deyoungjohn/ferry',
      emberAddress: 'bchtest:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy',
      priorRepoUrl: 'https://github.com/example/prior',
      priorDemoUrl: 'https://example.com/demo',
    };
    const warnings = getBannerWarnings(fullConfig);
    expect(warnings).toHaveLength(0);
  });
});
