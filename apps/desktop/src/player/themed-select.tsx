import React from 'react';

export interface ThemedOption { value: string; label: string }

/** A compact themed listbox used instead of platform-native select popups. */
export function ThemedSelect({ value, options, onChange, ariaLabel, className = '', align = 'end', searchable = false, searchPlaceholder = 'Search…', noResultsLabel = 'No matches', disabled = false }: {
  value: string;
  options: ThemedOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  align?: 'start' | 'end';
  searchable?: boolean;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const root = React.useRef<HTMLDivElement>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  React.useEffect(() => {
    if (!open) return undefined;
    if (searchable) requestAnimationFrame(() => searchInput.current?.focus());
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [open, searchable]);
  const selected = options.find(option => option.value === value)?.label ?? value;
  const filteredOptions = searchable && query.trim()
    ? options.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : options;
  return <div className={`themed-select ${align === 'start' ? 'align-start' : 'align-end'}${open ? ' is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`} ref={root}>
    <button type="button" className="themed-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-disabled={disabled} disabled={disabled} onClick={() => { if (disabled) return; setQuery(''); setOpen(current => !current); }}>{selected}<span aria-hidden="true">⌄</span></button>
    {open && <div className={`themed-select-menu${searchable ? ' searchable' : ''}`}>
      {searchable && <input ref={searchInput} className="themed-select-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`${ariaLabel} search`} onKeyDown={event => event.stopPropagation()} />}
      <div className="themed-select-options" role="listbox" aria-label={ariaLabel}>{filteredOptions.map(option => <button type="button" role="option" aria-selected={option.value === value} className={`themed-select-option${option.value === value ? ' active' : ''}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); setQuery(''); }}>{option.label}{option.value === value && <span aria-hidden="true">✓</span>}</button>)}
      {filteredOptions.length === 0 && <div className="themed-select-empty">{noResultsLabel}</div>}</div>
    </div>}
  </div>;
}
