import { useTranslation } from 'react-i18next';

/** Overview: landscapes across your projects (they arrive with server storage). */
export function HomePage() {
  const { t } = useTranslation('app');
  return (
    <>
      <header className="page__header">
        <h1 className="page__title">{t('platform.home.title')}</h1>
      </header>
      <div className="empty-state">
        <p className="empty-state__title">{t('platform.home.empty')}</p>
        <p className="empty-state__hint">{t('platform.home.emptyHint')}</p>
      </div>
    </>
  );
}
