import type { Metadata } from 'next'
import './globals.css'
import SiteNav from './components/SiteNav'

export const metadata: Metadata = {
  title: 'Fantasy Cycling',
  description: 'Fantasy cycling game',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-black text-white">
        <SiteNav />
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </body>
    </html>
  )
}