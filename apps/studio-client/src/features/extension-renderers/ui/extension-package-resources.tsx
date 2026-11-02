import { useWorkbenchView } from '../../../shared/studio-shell/use-workbench-view.js'
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, IconButton } from '@loom-studio/ui'
import { BookOpen, Braces, Code, ExternalLink, Info, Image, ListOrdered, Palette, Regex, WandSparkles, Wrench } from 'lucide-react'
import type { ManagedExtensionPackage, PromptResource } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { PanelTabs } from '../../../shared/ui/panel-tabs/index.js'
import { packageResourceEntries, packageResourceUrl, previewPackageResource, readPackageResource, type PackageResourceEntry, type PackageResourceKind } from '../model/package-resource-preview.js'
import styles from './extension-package-resources.module.scss'

export function ExtensionPackageTabs(props: { overview: ReactNode; resources: ReactNode; settings?: ReactNode; t: Translator }) {
  const [selectedTab, setTab] = useWorkbenchView<'overview' | 'resources' | 'settings'>('extension.details', 'overview', ['overview', 'resources', 'settings'])
  const tab = selectedTab === 'settings' && !props.settings ? 'overview' : selectedTab
  return <section data-loom-mobile-tab-scope="" className={styles.tabs}>
    <PanelTabs activeId={tab} onChange={setTab} ariaLabel={props.t('renderer.packageDetails')}
      items={[{ id: 'overview', label: props.t('renderer.overview') }, { id: 'resources', label: props.t('renderer.resources') },
        ...(props.settings ? [{ id: 'settings' as const, label: props.t('renderer.settings') }] : [])]} />
    <div role="tabpanel" aria-label={props.t(tab === 'overview' ? 'renderer.overview' : tab === 'resources' ? 'renderer.resources' : 'renderer.settings')}>
      {tab === 'resources' ? props.resources : tab === 'settings' && props.settings ? props.settings : props.overview}
    </div>
  </section>
}

const categories = [
  { kind: 'preset', key: 'renderer.resourcePreset', Icon: ListOrdered },
  { kind: 'lore', key: 'renderer.resourceLore', Icon: BookOpen },
  { kind: 'prompt', key: 'renderer.promptResource', Icon: Braces },
  { kind: 'script', key: 'renderer.loomScript', Icon: Code },
  { kind: 'tool', key: 'renderer.agentTool', Icon: Wrench },
  { kind: 'rule', key: 'renderer.transformRule', Icon: Regex },
  { kind: 'extractor', key: 'renderer.textExtractor', Icon: Braces },
  { kind: 'theme', key: 'renderer.resourceTheme', Icon: Palette },
  { kind: 'style', key: 'renderer.resourceStyle', Icon: WandSparkles },
  { kind: 'background', key: 'renderer.resourceBackground', Icon: Image },
] as const

export function ExtensionPackageResources(props: {
  extensionPackage: ManagedExtensionPackage
  promptResources: PromptResource[]
  onOpenResource(entry: PackageResourceEntry): Promise<void>
  t: Translator
}) {
  const entries = packageResourceEntries(props.extensionPackage)
  const available = categories.filter(category => entries.some(entry => entry.kind === category.kind))
  const [selection, setSelection] = useWorkbenchView<PackageResourceKind>('extension.resource-category', available[0]?.kind ?? 'preset', available.map(item => item.kind))
  const category = available.find(item => item.kind === selection) ?? available[0]
  if (!category) return <p className={styles.empty}>{props.t('renderer.noPackageResources')}</p>
  return <div className={styles.resourceLayout}>
      <nav className={styles.categories} aria-label={props.t('renderer.resourceCategories')}>
        {available.map(({ kind, key, Icon }) => <button key={kind} type="button" aria-current={kind === category.kind ? 'true' : undefined}
          onClick={() => setSelection(kind)}><Icon size={16} aria-hidden="true" /><span>{props.t(key)}</span><small>{entries.filter(entry => entry.kind === kind).length}</small></button>)}
      </nav>
      <label className={styles.mobileCategory}>{props.t('renderer.resourceCategories')}
        <select value={category.kind} onChange={event => setSelection(event.target.value as PackageResourceKind)}>
          {available.map(item => <option key={item.kind} value={item.kind}>{props.t(item.key)} · {entries.filter(entry => entry.kind === item.kind).length}</option>)}
        </select>
      </label>
      <section className={styles.resources} aria-label={props.t(category.key)}>
        <header className={styles.categoryHeader}><h3>{props.t(category.key)}</h3><p>{props.t('renderer.packageContentHint')}</p></header>
        {entries.filter(entry => entry.kind === category.kind).map(entry => <ResourceCard key={`${entry.kind}:${entry.id}`} entry={entry} {...props} />)}
      </section>
  </div>
}

function ResourceCard(props: Parameters<typeof ExtensionPackageResources>[0] & { entry: PackageResourceEntry }) {
  const { entry, extensionPackage: pkg, t } = props
  const [infoOpen, setInfoOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [navigationError, setNavigationError] = useState<string>()
  const query = useQuery({
    queryKey: ['extension-resource-preview', pkg.packageId, pkg.target, pkg.fileRevision ?? pkg.version, pkg.archiveDigest, entry.kind, entry.id, entry.source],
    enabled: entry.kind !== 'background',
    queryFn: async ({ signal }) => previewPackageResource(entry, await readPackageResource(packageResourceUrl(pkg, entry.source), signal)),
  })
  const imported = props.promptResources.filter(resource => resource.origin?.kind === 'extension-package' && resource.origin.contributionId === entry.id)
  const title = query.data?.title ?? entry.label ?? imported[0]?.rootNode.label ?? entry.id
  const description = query.data?.description ?? entry.description
  async function openResource() {
    setOpening(true)
    setNavigationError(undefined)
    try { await props.onOpenResource(entry) }
    catch (cause) { setNavigationError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setOpening(false) }
  }
  const loading = query.isPending && entry.kind !== 'background' ? <p role="status">{t('renderer.resourceLoading')}</p> : null
  const failure = query.error ? <div role="alert"><p>{t('renderer.resourceLoadFailed')}: {query.error.message}</p>
    <Button size="small" onClick={() => void query.refetch()}>{t('renderer.resourceRetry')}</Button></div> : null
  return <article className={styles.resource}>
    <header>
      <h4>{title}</h4>
      {imported.length ? <span className={styles.status}>{t('renderer.resourceImported')}</span> : null}
      <div className={styles.actions}>
        <IconButton size="small" aria-label={t('renderer.resourceInfo')} onClick={() => setInfoOpen(true)}><Info size={16} aria-hidden="true" /></IconButton>
        <IconButton size="small" aria-label={t('renderer.openResourceWorkspace')} disabled={opening} onClick={() => void openResource()}><ExternalLink size={16} aria-hidden="true" /></IconButton>
      </div>
    </header>
    {description ? <p>{description}</p> : null}
    {query.data?.swatches?.length ? <div className={styles.swatches}>{query.data.swatches.map(color => <span key={color}><i style={{ backgroundColor: color }} aria-hidden="true" /><code>{color}</code></span>)}</div> : null}
    {entry.kind === 'background' ? <img className={styles.background} src={packageResourceUrl(pkg, entry.source)} alt={title} loading="lazy" /> : null}
    {loading}{failure}
    {navigationError ? <p role="alert">{navigationError}</p> : null}
    {infoOpen ? <Dialog open title={title} titleIcon={<Info size={18} />} layout="workbench" onClose={() => setInfoOpen(false)}>
      <div className={styles.information}>
        {description ? <p>{description}</p> : null}
        <dl><dt>{t('renderer.owner')}</dt><dd>{pkg.packageId}@{pkg.version}</dd><dt>ID</dt><dd>{entry.id}</dd><dt>{t('renderer.source')}</dt><dd>{entry.source}</dd>
          {query.data?.facts?.map(fact => <div className={styles.fact} key={fact.kind}><dt>{t(`renderer.resourceFact.${fact.kind}`)}</dt><dd>{fact.value}</dd></div>)}
          {entry.parameters?.map((parameter, index) => <div className={styles.fact} key={index}><dt>{parameter.label}</dt><dd>{String(parameter.default)}</dd></div>)}
        </dl>
        {loading}{failure}
        {query.data ? <section>
          <h3>{t('renderer.resourceContent')}</h3>
          {query.data.sections.length ? query.data.sections.map((section, index) => <section key={index}>
            <h4>{section.label}</h4>
            {section.source ? <ResourceBody pkg={pkg} source={section.source} t={t} /> : <pre>{section.body}</pre>}
          </section>) : <pre>{query.data.source}</pre>}
        </section> : null}
        {entry.kind === 'background' ? <img className={styles.background} src={packageResourceUrl(pkg, entry.source)} alt={title} /> : null}
        <section><h3>{t('renderer.resourceDeclaration')}</h3><pre>{JSON.stringify(entry.declaration, null, 2)}</pre></section>
      </div>
    </Dialog> : null}
  </article>
}

function ResourceBody(props: { pkg: ManagedExtensionPackage; source: string; t: Translator }) {
  const query = useQuery({ queryKey: ['extension-resource-body', props.pkg.packageId, props.pkg.target, props.pkg.fileRevision ?? props.pkg.version, props.pkg.archiveDigest, props.source],
    queryFn: ({ signal }) => readPackageResource(packageResourceUrl(props.pkg, props.source), signal) })
  if (query.error) return <div role="alert">{props.t('renderer.resourceLoadFailed')}: {query.error.message} <Button size="small" onClick={() => void query.refetch()}>{props.t('renderer.resourceRetry')}</Button></div>
  return <pre>{query.isPending ? props.t('renderer.resourceLoading') : query.data}</pre>
}
