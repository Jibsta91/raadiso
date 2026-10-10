import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('body')}</p>
      <Link href="/" className="mt-6 inline-block text-primary underline-offset-4 hover:underline">
        {t('home')}
      </Link>
    </div>
  );
}
