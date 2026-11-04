import { Search, X } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inputRef.current!, [])
  return (
    <label className={containerClassName} data-loom-ui-search-field="">
      <Search aria-hidden="true" />
      <input ref={inputRef} {...props} type="search" value={value} />
      {value ? (
        <button aria-label={clearLabel} title={clearLabel} type="button" onClick={() => { inputRef.current?.focus(); onClear() }}>
          <X aria-hidden="true" />
        </button>
      ) : <span aria-hidden="true" data-clear-placeholder="" />}
    </label>
  )
})
