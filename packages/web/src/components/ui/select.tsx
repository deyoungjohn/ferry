import {
  MorphSelect,
  MorphSelectContent,
  MorphSelectItem,
  MorphSelectTrigger,
  MorphSelectValue,
} from './select-morph';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Artwork before the label (see lib/icons). */
  readonly icon?: string | null | undefined;
}

export interface SelectProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  /** The accessible name: every dropdown on the site needs one. */
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly triggerClassName?: string;
}

/**
 * The one dropdown used across the site: the trigger grows into the list and shrinks back. Pass the
 * options as data; the visible label and the accessible name are separate.
 */
export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  disabled,
  className,
  triggerClassName,
}: SelectProps) {
  // The visible text (the chosen option) must be part of the accessible name.
  const chosen = options.find((option) => option.value === value)?.label;
  const accessibleName = chosen ? `${label}: ${chosen}` : label;

  return (
    <MorphSelect
      value={value}
      onValueChange={onValueChange}
      disabled={disabled ?? false}
      {...(className !== undefined ? { className } : {})}
    >
      <MorphSelectTrigger
        aria-label={accessibleName}
        {...(triggerClassName !== undefined
          ? { className: triggerClassName }
          : {})}
      >
        <MorphSelectValue
          {...(placeholder !== undefined ? { placeholder } : {})}
        />
      </MorphSelectTrigger>
      <MorphSelectContent>
        {options.map((option) => (
          <MorphSelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled ?? false}
            icon={option.icon ?? undefined}
          >
            {option.label}
          </MorphSelectItem>
        ))}
      </MorphSelectContent>
    </MorphSelect>
  );
}
