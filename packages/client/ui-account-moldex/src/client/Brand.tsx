/** Moldex sidebar brand occupants for `sidebar.brand.*` slots. */
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MoldexKey } from './locales.ts'
import moldexMark from './moldex-mark.png'
import css from './Brand.module.css'

/**
 * Render the Moldex mark at the size requested by the sidebar host.
 * @param props - Host-supplied mark presentation.
 * @returns the Moldex logomark.
 */
export function MoldexBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <img
      className={css.mark}
      src={moldexMark}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

/**
 * Render the Moldex product name for the expanded sidebar brand row.
 * @param props - Locale-backed copy from the Moldex client dictionary.
 * @returns the Moldex title text.
 */
export function MoldexBrandName(props: PropsLocale<'settings.moldex'>) {
  const { t } = props
  return <span className={css.name}>{t('brandName' satisfies MoldexKey)}</span>
}
