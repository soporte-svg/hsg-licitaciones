import type { ReactNode } from 'react'

type PageChromeProps = {
  children: ReactNode
  /** Fondo con blobs (login). En dashboard usar `false` para UI plana tipo admin. */
  blur?: boolean
}

export function PageChrome({ children, blur = true }: PageChromeProps) {
  return (
    <div className={blur ? 'page' : 'page page--plain'}>
      {blur ? (
        <div className="page__blobs" aria-hidden="true">
          <div className="page__blob page__blob--tr" />
          <div className="page__blob page__blob--bl" />
          <div className="page__blob page__blob--c" />
        </div>
      ) : null}
      {children}
    </div>
  )
}
