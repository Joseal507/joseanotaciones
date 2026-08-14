import { notFound } from 'next/navigation';
import FreeContinuityHarness from './FreeContinuityHarness';

export default function E2EFreeContinuityPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FreeContinuityHarness />;
}
