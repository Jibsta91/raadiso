import { getFormatter } from 'next-intl/server';

/** "3 minutes ago", with the exact time on hover (server-rendered). */
export async function Ago({ at, className }: { at: string | Date; className?: string }) {
  const format = await getFormatter();
  const date = typeof at === 'string' ? new Date(at) : at;
  return (
    <time
      dateTime={date.toISOString()}
      title={format.dateTime(date, { dateStyle: 'medium', timeStyle: 'medium' })}
      className={className}
    >
      {format.relativeTime(date, new Date())}
    </time>
  );
}
