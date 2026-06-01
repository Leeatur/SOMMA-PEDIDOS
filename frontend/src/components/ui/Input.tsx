import React from 'react'
import { X } from 'lucide-react'
import { clsx } from '../../utils/clsx'
import { maskCnpj, maskCpf, maskPhone, maskCep, maskDecimal, maskPercent } from '../../utils/masks'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
  rightElement?: React.ReactNode
  onClear?: () => void
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, rightElement, onClear, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    const hasValue = String(props.value ?? '').length > 0
    const showClear = onClear && hasValue
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-[12px] font-medium text-on-surface mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'block w-full rounded-lg border text-[14px] transition-all',
              'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
              'disabled:bg-surface-container-low disabled:text-outline disabled:cursor-not-allowed',
              error
                ? 'border-error bg-error-container/20 text-error placeholder-error/50 focus:ring-error/30 focus:border-error'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface placeholder-outline',
              leftIcon ? 'pl-10' : 'pl-3',
              (rightElement || showClear) ? 'pr-10' : 'pr-3',
              'py-1.5',
              className
            )}
            {...props}
          />
          {showClear ? (
            <button
              type="button"
              onClick={onClear}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-outline/50 hover:text-on-surface transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : rightElement ? (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {rightElement}
            </div>
          ) : null}
        </div>
        {error && <p className="mt-1 text-[12px] text-error">{error}</p>}
        {hint && !error && <p className="mt-1 text-[12px] text-outline">{hint}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-[12px] font-medium text-on-surface mb-1.5">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={clsx(
            'block w-full rounded-lg border text-[14px] transition-all',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:bg-surface-container-low disabled:text-outline disabled:cursor-not-allowed',
            error
              ? 'border-error bg-error-container/20 text-error'
              : 'border-outline-variant bg-surface-container-lowest text-on-surface',
            'px-3 py-1.5 resize-none',
            className
          )}
          {...props}
        />
        {error && <p className="mt-1 text-[12px] text-error">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: Array<{ value: string; label: string }>
  placeholder?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-[12px] font-medium text-on-surface mb-1.5">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={clsx(
            'block w-full rounded-lg border text-[14px] transition-all',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
            'disabled:bg-surface-container-low disabled:text-outline disabled:cursor-not-allowed',
            error
              ? 'border-error bg-error-container/20 text-error'
              : 'border-outline-variant bg-surface-container-lowest text-on-surface',
            'px-3 py-1.5',
            className
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="mt-1 text-[12px] text-error">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

// ─── MaskedInput ───────────────────────────────────────────────────────────

const MASK_MAP = {
  cnpj:    { fn: maskCnpj,    placeholder: '00.000.000/0001-00', maxLength: 18, inputMode: 'numeric' },
  cpf:     { fn: maskCpf,     placeholder: '000.000.000-00',     maxLength: 14, inputMode: 'numeric' },
  phone:   { fn: maskPhone,   placeholder: '(00) 00000-0000',    maxLength: 15, inputMode: 'tel'     },
  cep:     { fn: maskCep,     placeholder: '00000-000',          maxLength:  9, inputMode: 'numeric' },
  decimal: { fn: (v: string) => maskDecimal(v, 2), placeholder: '0,00', maxLength: 20, inputMode: 'decimal' },
  percent: { fn: maskPercent, placeholder: '0,00',               maxLength:  7, inputMode: 'decimal' },
} as const

export type MaskType = keyof typeof MASK_MAP

interface MaskedInputProps extends Omit<InputProps, 'onChange' | 'maxLength' | 'inputMode' | 'placeholder'> {
  mask: MaskType
  onChangeValue: (formatted: string) => void
  placeholder?: string
}

export const MaskedInput = React.forwardRef<HTMLInputElement, MaskedInputProps>(
  ({ mask, onChangeValue, ...props }, ref) => {
    const cfg = MASK_MAP[mask]
    return (
      <Input
        ref={ref}
        inputMode={cfg.inputMode as React.HTMLAttributes<HTMLInputElement>['inputMode']}
        placeholder={props.placeholder ?? cfg.placeholder}
        maxLength={cfg.maxLength}
        onChange={(e) => onChangeValue(cfg.fn(e.target.value))}
        {...props}
      />
    )
  }
)
MaskedInput.displayName = 'MaskedInput'
