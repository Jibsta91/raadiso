import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privacy');
  return { title: t('title') };
}

const SECTIONS = ['controller', 'data', 'cookies', 'ai', 'rights', 'retention', 'contact'] as const;

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('privacy');
  return (
    <article className="prose mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('intro')}</p>
      {SECTIONS.map((s) => (
        <section key={s}>
          <h2 className="text-xl font-semibold">{t(`${s}.title`)}</h2>
          <p className="mt-1">{t(`${s}.body`)}</p>
        </section>
      ))}
    </article>
  );
}
