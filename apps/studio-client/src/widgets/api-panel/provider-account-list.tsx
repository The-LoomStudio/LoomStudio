import type { ProviderAccount } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './api-panel.module.css'

type ProviderAccountListProps = {
  accounts: ProviderAccount[]
  busy: boolean
  onDelete: (id: string) => void
  t: Translator
}

export function ProviderAccountList(props: ProviderAccountListProps) {
  return (
    <div className={styles.entityList}>
      {props.accounts.length === 0 ? (
        <p className={styles.entityEmpty}>{props.t('gateway.noProviderAccounts')}</p>
      ) : (
        props.accounts.map(account => (
          <div key={account.id} className={styles.entityItem}>
            <div className={styles.entityInfo}>
              <span className={styles.entityName}>{account.displayName}</span>
              <span className={styles.entityMeta}>{account.providerExtensionId}</span>
              {account.config.baseUrl ? (
                <span className={styles.entityMeta}>{String(account.config.baseUrl)}</span>
              ) : null}
            </div>
            <div className={styles.entityActions}>
              <button
                className={styles.entityActionDanger}
                type="button"
                onClick={() => props.onDelete(account.id)}
                disabled={props.busy}
              >
                {props.t('gateway.delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
