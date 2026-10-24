import { useState } from 'react'
import styles from './user-identity.module.scss'

export type UserIdentityView = { name: string; avatarUrl?: string }

export function UserIdentity({ name, avatarUrl }: UserIdentityView) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return <span className={styles.identity}>
    <span className={styles.avatar} aria-hidden="true">
      {avatarUrl && failedUrl !== avatarUrl
        ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        : Array.from(name)[0] || 'U'}
    </span>
    <span>{name}</span>
  </span>
}
