'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import LogoutButton from './LogoutButton'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/races', label: 'Races' },
  { href: '/ranking', label: 'Classement' },
  { href: '/rules', label: 'Règles' },
  { href: '/admin/import', label: 'Admin import' },
]

export default function SiteNav() {
  const pathname = usePathname()

  if (pathname === '/login' || pathname.startsWith('/auth')) {
    return null
  }

  return (
    <header className="border-b border-white/10 sticky top-0 z-40 bg-black/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
        <Link href="/dashboard" className="font-bold text-lg mr-3">
          Fantasy Cycling
        </Link>

        <nav className="flex items-center gap-2 flex-wrap">
          {links.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== '/' && pathname.startsWith(link.href))

            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  'rounded-md px-3 py-2 text-sm transition ' +
                  (active
                    ? 'bg-white text-black font-semibold'
                    : 'hover:bg-white/10 text-white/90')
                }
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto">
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}
