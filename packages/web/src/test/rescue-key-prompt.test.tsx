import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RescueKeyPrompt } from '../components/RescueKeyPrompt';
import * as recoveryService from '../lib/recovery/recovery-key-service';

describe('RescueKeyPrompt', () => {
  const dummyRoot =
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;

  beforeEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('renders rescue key prompt when not saved, and allows copying / downloading', async () => {
    vi.spyOn(recoveryService, 'isRescueKeySaved').mockResolvedValue(false);
    vi.spyOn(recoveryService, 'getOrCreateRescueRoot').mockResolvedValue(
      dummyRoot,
    );
    const markSavedSpy = vi
      .spyOn(recoveryService, 'markRescueKeySaved')
      .mockResolvedValue();

    render(<RescueKeyPrompt />);

    const prompt = await screen.findByTestId('rescue-key-prompt');
    expect(prompt).toBeInTheDocument();
    expect(screen.getByTestId('rescue-key-display')).toHaveTextContent(
      dummyRoot,
    );

    // Download button
    fireEvent.click(screen.getByTestId('download-rescue-key'));
    expect(URL.createObjectURL).toHaveBeenCalled();

    // Dismiss button
    fireEvent.click(screen.getByTestId('dismiss-rescue-key'));
    expect(markSavedSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('rescue-key-prompt')).not.toBeInTheDocument(),
    );
  });

  it('does not render when rescue key is already saved', async () => {
    vi.spyOn(recoveryService, 'isRescueKeySaved').mockResolvedValue(true);
    const getRootSpy = vi.spyOn(recoveryService, 'getOrCreateRescueRoot');

    render(<RescueKeyPrompt />);

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('rescue-key-prompt')).not.toBeInTheDocument();
    expect(getRootSpy).not.toHaveBeenCalled();
  });
});
