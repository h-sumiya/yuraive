import type { ReactNode } from 'react'

export const Icon = ({ name, size = 16 }: { name: string; size?: number }) => {
  const paths: Record<string, ReactNode> = {
    folder: (
      <>
        <path d="M3 5.5h6l1.8 2H21v10.5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z" />
        <path d="M1 9h20" />
      </>
    ),
    file: (
      <>
        <path d="M5 2h9l5 5v15H5z" />
        <path d="M14 2v5h5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="1" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    save: (
      <>
        <path d="M4 3h14l3 3v15H3V3z" />
        <path d="M7 3v6h9V3M7 21v-8h10v8" />
      </>
    ),
    play: <path d="m7 4 13 8-13 8z" />,
    check: <path d="m4 12 5 5L20 6" />,
    warning: (
      <>
        <path d="M12 3 2 21h20z" />
        <path d="M12 9v5m0 3v.1" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    media: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4z" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <circle cx="9" cy="9" r="2" />
        <path d="m4 17 5-5 3 3 2-2 6 5" />
      </>
    ),
    code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-13-4 16" />,
    script: (
      <>
        <path d="M5 3h11l3 3v18H5z" />
        <path d="M16 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    bug: (
      <>
        <path d="M8 9h8M9 4h6l1 3H8zM7 7l-2 3v8l3 3h8l3-3v-8l-2-3M3 13h4m10 0h4" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    link: (
      <>
        <path d="M10 14 8 16a4 4 0 0 1-6-6l3-3a4 4 0 0 1 6 0" />
        <path d="m14 10 2-2a4 4 0 1 1 6 6l-3 3a4 4 0 0 1-6 0M8 12h8" />
      </>
    ),
    dots: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    fit: (
      <>
        <path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" />
      </>
    ),
    expandAll: (
      <>
        <path d="m7 5 5 5 5-5M7 14l5 5 5-5" />
        <path d="M4 1h16M4 23h16" />
      </>
    ),
    collapseAll: (
      <>
        <path d="m7 10 5-5 5 5M7 14l5 5 5-5" />
        <path d="M4 12h16" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M6.1 8a7 7 0 0 1 11.4-2.2L20 8M4 16l2.5 2.2A7 7 0 0 0 17.9 16" />
      </>
    ),
    controls: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v.1" />
      </>
    ),
  }
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}
