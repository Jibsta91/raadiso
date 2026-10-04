import { redirect } from 'next/navigation';
import { env } from '@/lib/env';

/** Moderation moved to the admin console (admin.<domain>, ADR-0028). */
export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`${env.adminBaseUrl}/${locale}/admin/moderation`);
}
