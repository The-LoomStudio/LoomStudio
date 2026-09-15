import { Search, X } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  clearLabel: string
  containerClassName?: string
  value: string
  onClear(): void
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { clearLabel, containerClassName, onClear, value, ...props },
  ref,
) {
  return (
    <label className={containerClassName} data-loom-ui-search-field="">
      <Search aria-hidden="true" />
      <input ref={ref} {...props} type="search" value={value} />
      {value ? (
        <button aria-label={clearLabel} title={clearLabel} type="button" onClick={onClear}>
          <X aria-hidden="true" />
        </button>
      ) : <span aria-hidden="true" data-clear-placeholder="" />}
    </label>
  )
})
