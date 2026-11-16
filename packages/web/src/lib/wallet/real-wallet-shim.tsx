import type { ReactNode } from 'react';

export function MockWalletProvider({
  children,
}: {
  readonly children?: ReactNode;
}) {
  return <>{children}</>;
}
