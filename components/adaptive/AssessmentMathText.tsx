'use client'

import { AcademicContent } from '../academic/AcademicContent'

export function AssessmentMathText({ children, inline = false }: { children: string; inline?: boolean }) {
  return <AcademicContent content={children} inline={inline} />
}
