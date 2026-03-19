import { Suspense } from 'react'
import AdminImportClient from './AdminImportClient'

export default function Page() {
  return (
    <Suspense fallback={<div className="p-10">Chargement...</div>}>
      <AdminImportClient />
    </Suspense>
  )
}
