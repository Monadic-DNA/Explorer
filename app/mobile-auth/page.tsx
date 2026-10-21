import { Suspense } from 'react';
import MobileAuth from './mobile-auth';

export const metadata = { title: 'Connect Explorer on your device', robots: { index: false, follow: false } };
export default function MobileAuthPage() {
  return <Suspense fallback={<main>Preparing secure sign-in…</main>}><MobileAuth /></Suspense>;
}
