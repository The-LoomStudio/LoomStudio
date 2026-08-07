import { t } from '../shared/i18n/index.js'
import { AppStatusPage } from './app-status-page.js'

export function NotFoundPage() {
  return (
    <AppStatusPage
      actions={<a href="/studio/chat">{t('notFound.returnChat')}</a>}
      description={t('notFound.description')}
      eyebrow="404"
      prominentEyebrow
      title={t('notFound.title')}
    />
  )
}
