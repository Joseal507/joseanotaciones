import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

w("lib/client-auth.ts", `
import { getSession } from 'next-auth/react';

export async function getCurrentSession() {
  return await getSession();
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getSession();
  return ((session?.user as any)?.id as string) || null;
}

export async function requireCurrentUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error('No hay sesión activa');
  return id;
}
`);

w("lib/materials/upload.ts", `
// ═══════════════════════════════════════════════
// CLIENTE DE UPLOAD — NextAuth + R2 + D1
// ═══════════════════════════════════════════════

import { requireCurrentUserId } from '../client-auth';
import type { MaterialUI } from './types';

export interface UploadProgress {
  materialId: string;
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completing' | 'done' | 'error';
  error?: string;
  material?: MaterialUI;
}

export type OnProgress = (updates: UploadProgress[]) => void;

export async function uploadMaterials(
  files: File[],
  temaId: string,
  materiaId: string,
  onProgress: OnProgress,
): Promise<MaterialUI[]> {
  await requireCurrentUserId();

  const progress: UploadProgress[] = files.map(f => ({
    materialId: '',
    fileName: f.name,
    progress: 0,
    status: 'pending',
  }));
  onProgress([...progress]);

  const initRes = await fetch('/api/materials/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      temaId,
      materiaId,
      files: files.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err.error ?? 'Error iniciando upload');
  }

  const { uploads } = await initRes.json();
  const results: MaterialUI[] = [];

  for (let i = 0; i < files.length; i += 2) {
    const batch = files.slice(i, i + 2);
    const batchUploads = uploads.slice(i, i + 2);

    await Promise.all(
      batch.map(async (file, bi) => {
        const upload = batchUploads[bi];
        const idx = i + bi;

        progress[idx] = {
          ...progress[idx],
          materialId: upload.materialId,
          status: 'uploading',
          progress: 0,
        };
        onProgress([...progress]);

        try {
          await uploadWithProgress(upload.uploadUrl, file, pct => {
            progress[idx] = { ...progress[idx], progress: pct };
            onProgress([...progress]);
          });

          progress[idx] = { ...progress[idx], status: 'completing', progress: 100 };
          onProgress([...progress]);

          const completeRes = await fetch('/api/materials/upload/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ materialId: upload.materialId }),
          });

          const completeData = await completeRes.json().catch(() => ({}));
          if (!completeRes.ok || !completeData.success) {
            throw new Error(completeData.error ?? 'Error completando upload');
          }

          progress[idx] = {
            ...progress[idx],
            status: 'done',
            material: completeData.material,
          };
          results.push(completeData.material);
        } catch (err: any) {
          progress[idx] = {
            ...progress[idx],
            status: 'error',
            error: err.message,
          };
        }

        onProgress([...progress]);
      }),
    );
  }

  return results;
}

function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(\`R2 upload failed: \${xhr.status}\`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Error de red')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelado')));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return \`\${bytes} B\`;
  if (bytes < 1024 * 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`;
  return \`\${(bytes / 1024 / 1024).toFixed(1)} MB\`;
}

export function kindEmoji(kind: string): string {
  const map: Record<string, string> = {
    pdf: '📄',
    docx: '📃',
    pptx: '📊',
    txt: '📝',
    image: '🖼️',
    audio: '🎵',
  };
  return map[kind] ?? '📁';
}
`);

let useContent = fs.readFileSync("lib/materials/useContent.ts", "utf8");
useContent = useContent.replace("import { supabase } from '../supabase';\n", "");
useContent = useContent.replace(/const session = \(await supabase\.auth\.getSession\(\)\)\.data\.session;\s*if \(!session\) throw new Error\('No hay sesión'\);\s*/g, "");
useContent = useContent.replace(/const session = \(await supabase\.auth\.getSession\(\)\)\.data\.session;\s*if \(!session\) throw new Error\('No hay sesión activa'\);\s*/g, "");
useContent = useContent.replace(/,\s*Authorization: `Bearer \$\{session\.access_token\}`/g, "");
useContent = useContent.replace(/headers: \{\s*'Content-Type': 'application\/json',\s*\}/g, "headers: { 'Content-Type': 'application/json' },\n            credentials: 'same-origin'");
useContent = useContent.replace(/headers: \{\s*'Content-Type': 'application\/json',\s*\},/g, "headers: { 'Content-Type': 'application/json' },\n    credentials: 'same-origin',");
fs.writeFileSync("lib/materials/useContent.ts", useContent);
console.log("patched lib/materials/useContent.ts");
