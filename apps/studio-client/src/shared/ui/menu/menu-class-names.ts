type MenuStyles = Record<string, string>

export function menuItemClass(
  styles: MenuStyles,
  options: { className?: string; inset?: boolean; tone?: 'default' | 'danger'; subTrigger?: boolean },
): string {
  return [
    styles.item,
    options.subTrigger ? styles.subTrigger : '',
    options.tone === 'danger' ? styles.danger : '',
    options.inset ? styles.inset : '',
    options.className ?? '',
  ].filter(Boolean).join(' ')
}

export function menuPartClass(base: string, className?: string): string {
  return [base, className ?? ''].filter(Boolean).join(' ')
}
