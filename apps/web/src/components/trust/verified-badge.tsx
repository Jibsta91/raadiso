import { ShieldCheck } from 'lucide-react';

/** "Verified with BankID". */
export function VerifiedBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-verified-soft px-2 py-0.5 text-xs font-medium text-verified"
      data-testid="verified-badge"
    >
      <ShieldCheck aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
