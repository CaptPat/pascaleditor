'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { z } from 'zod'
import { apiGraphSchema } from '@/lib/graph-schema'

const ENVELOPE_VERSION = 1

const exportEnvelopeSchema = z.object({
  envelope: z.literal('pascal-scene-export'),
  envelopeVersion: z.number().int().positive(),
  name: z.string().min(1).max(200),
  graph: apiGraphSchema,
  exportedAt: z.string().datetime(),
  sourceVersion: z.number().int().nonnegative(),
})

interface ExportSceneButtonProps {
  sceneId: string
  name: string
  className?: string
}

/**
 * Downloads the current scene as a JSON envelope. Pairs with
 * ImportSceneButton for round-trip persistence outside the server's
 * SQLite store.
 */
export function ExportSceneButton({ sceneId, name, className }: ExportSceneButtonProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsExporting(true)
      setError(null)
      try {
        const res = await fetch(`/api/scenes/${sceneId}`)
        if (!res.ok) {
          setError(`Export failed (${res.status})`)
          return
        }
        const scene = (await res.json()) as { name: string; version: number; graph: unknown }
        const envelope = {
          envelope: 'pascal-scene-export' as const,
          envelopeVersion: ENVELOPE_VERSION,
          name: scene.name,
          graph: scene.graph,
          exportedAt: new Date().toISOString(),
          sourceVersion: scene.version,
        }
        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const slug =
          (scene.name || name || 'scene')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'scene'
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${slug}.pascal-scene.json`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed')
      } finally {
        setIsExporting(false)
      }
    },
    [name, sceneId],
  )

  return (
    <div className={className}>
      <button
        aria-label="Export scene as JSON"
        className="rounded-md border border-border bg-background/90 px-2 py-1 font-medium text-xs shadow-sm hover:bg-accent/60 disabled:opacity-50"
        disabled={isExporting}
        onClick={handleExport}
        type="button"
      >
        {isExporting ? '…' : 'Export'}
      </button>
      {error && <span className="ml-2 text-destructive text-xs">{error}</span>}
    </div>
  )
}

interface ImportSceneButtonProps {
  label?: string
}

/**
 * Imports a Pascal scene JSON envelope. Validates the envelope and
 * graph against the canonical API schema, then POSTs as a new scene —
 * server-bound metadata from the source (id, version, ownerId) is
 * intentionally dropped so an import always produces a fresh,
 * owned-by-this-user scene.
 */
export function ImportSceneButton({ label = 'Import scene' }: ImportSceneButtonProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      setIsImporting(true)
      setError(null)
      try {
        const text = await file.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          setError('File is not valid JSON')
          return
        }
        const result = exportEnvelopeSchema.safeParse(parsed)
        if (!result.success) {
          const issue = result.error.issues[0]
          const path = issue?.path.join('.') ?? ''
          setError(
            `Invalid scene file${path ? ` at "${path}"` : ''}: ${issue?.message ?? 'unknown'}`,
          )
          return
        }
        if (result.data.envelopeVersion > ENVELOPE_VERSION) {
          setError(`Unsupported envelope version: ${result.data.envelopeVersion}`)
          return
        }
        const response = await fetch('/api/scenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: result.data.name, graph: result.data.graph }),
        })
        if (!response.ok) {
          setError(`Import failed (${response.status})`)
          return
        }
        const meta = (await response.json()) as { id: string }
        router.push(`/scene/${meta.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed')
      } finally {
        setIsImporting(false)
      }
    },
    [router],
  )

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-destructive text-xs">{error}</span>}
      <input
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileSelected}
        ref={fileInputRef}
        type="file"
      />
      <button
        className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-sm hover:bg-accent/40 disabled:opacity-50"
        disabled={isImporting}
        onClick={handlePickFile}
        type="button"
      >
        {isImporting ? 'Importing…' : label}
      </button>
    </div>
  )
}
