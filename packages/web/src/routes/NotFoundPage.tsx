import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="font-mono text-sm font-semibold text-lime">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text">
        Page Not Found
      </h1>
      <p className="mt-3 text-sm text-text-muted">
        The route you requested does not exist.
      </p>
      <Link
        to="/"
        className="mt-6 rounded-pill bg-surface-2 border border-hairline px-4 py-2 text-xs font-semibold text-text hover:bg-surface-3 transition-colors"
      >
        ← Back to Swap
      </Link>
    </div>
  );
}
