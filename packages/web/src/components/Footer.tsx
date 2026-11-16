import { Link } from 'react-router';
import { BANNER_CONFIG } from '../lib/config';
import { FOOTER_COPY } from '../lib/copy';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hairline bg-surface-1/40 py-12 text-xs text-text-muted">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6">
        <div>
          <p className="font-semibold text-text">
            Ferry<span className="text-lime">.</span>
          </p>
          <p className="mt-1 text-text-dim text-[11px]">
            {FOOTER_COPY.tagline}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-[11px]">
          <a href="#how-it-works" className="hover:text-text transition-colors">
            {FOOTER_COPY.howItWorks}
          </a>
          <a href="#faq" className="hover:text-text transition-colors">
            {FOOTER_COPY.faq}
          </a>
          <Link to="/status" className="hover:text-text transition-colors">
            {FOOTER_COPY.status}
          </Link>
          <Link to="/help" className="hover:text-text transition-colors">
            User Guide
          </Link>
          {BANNER_CONFIG.repoUrl && (
            <a
              href={BANNER_CONFIG.repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-text transition-colors"
            >
              {FOOTER_COPY.github}
            </a>
          )}
          {BANNER_CONFIG.licenseUrl && (
            <a
              href={BANNER_CONFIG.licenseUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-text transition-colors"
            >
              {FOOTER_COPY.license}
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}
