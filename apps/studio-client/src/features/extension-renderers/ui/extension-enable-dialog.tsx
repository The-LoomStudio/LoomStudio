import { Button, Dialog } from '@loom-studio/ui'
import { ShieldAlert, Server, Monitor, Cpu } from 'lucide-react'
import type { ManagedExtensionPackage, ManagedExtensionModule } from '../../../entities/extension.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './extension-enable-dialog.module.scss'

function getCapabilityLabel(key: string, t: Translator): string {
  const map: Record<string, string> = {
    'state.read': t('extension.cap.stateRead'),
    'state.write': t('extension.cap.stateWrite'),
    'state.contribute': t('extension.cap.stateContribute'),
    'ui.notify': t('extension.cap.uiNotify'),
    'assets.read': t('extension.cap.assetsRead'),
    'assets.publish': t('extension.cap.assetsPublish'),
  }
  return map[key] ?? key
}

function getRuntimeKindLabel(kind: string, t: Translator): string {
  const map: Record<string, string> = {
    server: t('extension.runtime.server'),
    client: t('extension.runtime.client'),
    'client-worker': t('extension.runtime.clientWorker'),
  }
  return map[kind] ?? kind
}

function parseCapabilities(module: ManagedExtensionModule, t: Translator): Array<{ id: string; label: string; desc?: string }> {
  const list: Array<{ id: string; label: string; desc?: string }> = []
  if (module.requestedCapabilities) {
    for (const [key, val] of Object.entries(module.requestedCapabilities)) {
      if (val === true || (Array.isArray(val) && val.length > 0) || (typeof val === 'object' && val !== null && Object.keys(val).length > 0)) {
        const base = getCapabilityLabel(key, t)
        list.push({
          id: key,
          label: base !== key ? `${base} (${key})` : key,
          desc: Array.isArray(val) ? val.join(', ') : undefined,
        })
      }
    }
  }
  if (module.requestedUiCapabilities?.length) {
    for (const cap of module.requestedUiCapabilities) {
      if (!list.some(item => item.id === cap)) {
        const base = getCapabilityLabel(cap, t)
        list.push({ id: cap, label: base !== cap ? `${base} (${cap})` : cap })
      }
    }
  }
  if (module.requestedAssetCapabilities?.length) {
    for (const cap of module.requestedAssetCapabilities) {
      if (!list.some(item => item.id === cap)) {
        const base = getCapabilityLabel(cap, t)
        list.push({ id: cap, label: base !== cap ? `${base} (${cap})` : cap })
      }
    }
  }
  if (module.requestedEventCapabilities?.length) {
    for (const cap of module.requestedEventCapabilities) {
      const id = `events.subscribe:${cap}`
      list.push({ id, label: t('extension.enable.eventSubscribe', { name: cap }) })
    }
  }
  return list
}

export function ExtensionEnableDialog(props: {
  open: boolean
  extensionPackage: ManagedExtensionPackage
  t: Translator
  busy?: boolean
  onClose(): void
  onConfirm(): void
}) {
  if (!props.open) return null
  const { extensionPackage, t, busy, onClose, onConfirm } = props
  const modulesToEnable = extensionPackage.modules.filter(module => !module.desired.enabled)
  const displayModules = modulesToEnable.length > 0 ? modulesToEnable : extensionPackage.modules

  return (
    <Dialog
      open
      title={t('extension.enable.title', { name: extensionPackage.displayName })}
      dismissible={!busy}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('renderer.remote.cancel')}
          </Button>
          <Button variant="default" disabled={busy} onClick={onConfirm}>
            {busy ? t('renderer.remote.busy') : t('renderer.enable')}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <div className={styles.warningBox} role="note">
          <ShieldAlert size={20} className={styles.warningIcon} aria-hidden="true" />
          <p>
            {t('extension.enable.warningIntro')}<strong>「{extensionPackage.displayName}」</strong>{t('extension.enable.warningCode')}{' '}
            {t('extension.enable.warningSafe')}
          </p>
        </div>

        <section className={styles.moduleSection} aria-label={t('extension.enable.modulesAndCapabilities')}>
          <h4 className={styles.sectionTitle}>{t('extension.enable.modulesAndCapabilities')}</h4>
          <div className={styles.moduleList}>
            {displayModules.map(module => {
              const capabilities = parseCapabilities(module, t)
              const RuntimeIcon = module.runtimeKind === 'server' ? Server : module.runtimeKind === 'client-worker' ? Cpu : Monitor
              return (
                <div key={module.moduleId} className={styles.moduleCard}>
                  <div className={styles.moduleHeader}>
                    <span className={styles.moduleName}>
                      <RuntimeIcon size={15} aria-hidden="true" />
                      <span>{module.moduleId}</span>
                    </span>
                    <span className={styles.runtimeBadge}>
                      {getRuntimeKindLabel(module.runtimeKind, t)}
                    </span>
                  </div>

                  {capabilities.length > 0 ? (
                    <div className={styles.capabilitiesList}>
                      {capabilities.map(cap => (
                        <span key={cap.id} className={styles.capabilityBadge} title={cap.desc}>
                          {cap.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.noCapabilities}>{t('extension.enable.noCapabilities')}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </Dialog>
  )
}
