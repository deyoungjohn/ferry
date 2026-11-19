import { useState } from 'react';
import { GlassModal } from '../GlassModal';
import { downloadJson } from '../../lib/send/download';

export interface SaveRecoveryDialogProps {
  readonly file: { readonly filename: string; readonly json: string } | null;
  /** The person saved the file and chose to go on. */
  readonly onContinue: () => void;
  /** The dialog was closed without going on: nothing is locked. */
  readonly onCancel: () => void;
}

/**
 * The recovery file is never downloaded behind the person's back: this asks them to save it, and
 * only then lets them go on to lock their funds.
 */
export function SaveRecoveryDialog({
  file,
  onContinue,
  onCancel,
}: SaveRecoveryDialogProps) {
  const [saved, setSaved] = useState(false);
  return (
    <GlassModal
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSaved(false);
          onCancel();
        }
      }}
      title="Save your recovery file first"
      description="It is the only way to get your funds back if this site is ever unreachable. Nothing is locked until you continue."
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-testid="save-recovery-file"
          onClick={() => {
            if (file) {
              downloadJson(file.filename, file.json);
              setSaved(true);
            }
          }}
          className="h-10 rounded-pill border border-hairline bg-surface-2 px-5 font-medium text-text"
        >
          Download recovery file
        </button>
        <button
          type="button"
          data-testid="continue-after-save"
          disabled={!saved}
          onClick={() => {
            setSaved(false);
            onContinue();
          }}
          className="h-10 rounded-pill bg-olive px-5 font-semibold text-text"
        >
          Continue to pay
        </button>
      </div>
    </GlassModal>
  );
}
