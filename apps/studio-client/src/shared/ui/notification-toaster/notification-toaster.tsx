import { Toaster } from 'sonner'
import 'sonner/dist/styles.css'
import styles from './notification-toaster.module.scss'

export function NotificationToaster(props: { bottomOffset: number; label: string }) {
  return (
    <Toaster
      closeButton
      containerAriaLabel={props.label}
      duration={8000}
      gap={8}
      mobileOffset={12}
      offset={{ right: 16, bottom: props.bottomOffset }}
      position="bottom-right"
      theme="dark"
      toastOptions={{
        unstyled: true,
        classNames: {
          actionButton: styles.actionButton,
          cancelButton: styles.cancelButton,
          closeButton: styles.closeButton,
          content: styles.content,
          description: styles.description,
          error: styles.error,
          icon: styles.icon,
          info: styles.info,
          success: styles.success,
          title: styles.title,
          toast: styles.toast,
          warning: styles.warning,
        },
      }}
      visibleToasts={4}
    />
  )
}
