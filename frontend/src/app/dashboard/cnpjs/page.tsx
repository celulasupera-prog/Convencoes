'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Plus, Briefcase, Activity, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { toast } from 'sonner'

interface TrackedCnpj {
  id: string
  cnpj: string
  name?: string
  employerUnionName?: string
  employerUnionCnpj?: string
  laborUnionName?: string
  laborUnionCnpj?: string
  baseMonth?: string
  isActive: boolean
  updatedAt: string
}

interface SearchRun {
  id: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  startedAt: string
  finishedAt?: string | null
  logs?: string | null
}

interface TrackedProgressItem {
  id: string
  label: string
  secondaryLabel: string
  status: 'PENDING' | 'RUNNING' | 'DONE_WITH_RESULTS' | 'DONE_NO_RESULTS' | 'FAILED'
  resultCount: number | null
}

function parseRunLogs(logs: string[]) {
  const findValue = (prefix: string) =>
    logs.find((line) => line.startsWith(prefix))?.slice(prefix.length)

  const failedMessage = findValue('failed:')
  const isCancelled = logs.some((line) => line.startsWith('cancelled:manual:'))
  const ajaxStatus = findValue('ajax-response-status:')
  const ajaxAttempts = findValue('ajax-attempt-count:')
  const debugPath = findValue('debug-artifact-base-path:')
  const completed = findValue('completed:')
  const completedMatch = completed?.match(/new=(\d+):updated=(\d+):total=(\d+)/)
  const legacyCompletedMatch = completed?.match(/new=(\d+):total=(\d+)/)

  const isPortalFailure =
    failedMessage?.includes('Falha no portal do MTE') ||
    ajaxStatus === '500'

  let summary = failedMessage || 'Nenhuma varredura executada ainda.'

  if (completedMatch) {
    const [, newCount, updatedCount, totalCount] = completedMatch
    summary = `Varredura concluida: ${newCount} novo(s), ${updatedCount} atualizado(s), ${totalCount} resultado(s) no total.`
  } else if (legacyCompletedMatch) {
    const [, newCount, totalCount] = legacyCompletedMatch
    const updatedCount = Math.max(Number(totalCount) - Number(newCount), 0)
    summary = `Varredura concluida: ${newCount} novo(s), ${updatedCount} atualizado(s), ${totalCount} resultado(s) no total.`
  }

  if (isPortalFailure) {
    summary = `Portal do MTE indisponivel no momento${ajaxAttempts ? ` apos ${ajaxAttempts} tentativa(s)` : ''}.`
  } else if (isCancelled) {
    summary = 'Varredura interrompida manualmente.'
  }

  return {
    ajaxAttempts,
    completed,
    debugPath,
    isCancelled,
    isPortalFailure,
    summary,
  }
}

function parseTrackedProgress(logs: string[], trackedItems: TrackedCnpj[]): TrackedProgressItem[] {
  const progressMap = new Map(
    trackedItems.map((item) => [
      item.id,
      {
        id: item.id,
        label: item.employerUnionName || item.name || 'Sindicato patronal sem nome',
        secondaryLabel: [item.employerUnionCnpj || item.cnpj, item.laborUnionName]
          .filter(Boolean)
          .join(' • '),
        status: 'PENDING' as TrackedProgressItem['status'],
        resultCount: null as number | null,
      },
    ]),
  )

  const fallbackByCnpj = new Map<string, string[]>()
  for (const item of trackedItems) {
    const key = item.cnpj.replace(/\D/g, '')
    const current = fallbackByCnpj.get(key) ?? []
    current.push(item.id)
    fallbackByCnpj.set(key, current)
  }

  const assignByCnpj = (
    rawCnpj: string,
    updater: (entry: TrackedProgressItem) => void,
  ) => {
    const ids = fallbackByCnpj.get(rawCnpj.replace(/\D/g, '')) ?? []
    const targetId = ids.find((id) => progressMap.get(id)?.status === 'PENDING') ?? ids[0]
    if (!targetId) return
    const entry = progressMap.get(targetId)
    if (!entry) return
    updater(entry)
  }

  for (const line of logs) {
    if (line.startsWith('processing-item:')) {
      const [, id] = line.split(':')
      const entry = progressMap.get(id)
      if (entry) entry.status = 'RUNNING'
      continue
    }

    if (line.startsWith('result-item:')) {
      const match = line.match(/^result-item:([^:]+):items=(\d+)$/)
      if (!match) continue
      const [, id, countText] = match
      const entry = progressMap.get(id)
      if (!entry) continue
      const count = Number(countText)
      entry.resultCount = count
      entry.status = count > 0 ? 'DONE_WITH_RESULTS' : 'DONE_NO_RESULTS'
      continue
    }

    if (line.startsWith('processed-item:')) {
      const match = line.match(/^processed-item:([^:]+):items=(\d+)$/)
      if (!match) continue
      const [, id, countText] = match
      const entry = progressMap.get(id)
      if (!entry) continue
      const count = Number(countText)
      entry.resultCount = count
      entry.status = count > 0 ? 'DONE_WITH_RESULTS' : 'DONE_NO_RESULTS'
      continue
    }

    if (line.startsWith('processing:')) {
      assignByCnpj(line.slice('processing:'.length), (entry) => {
        if (entry.status === 'PENDING') entry.status = 'RUNNING'
      })
      continue
    }

    if (line.startsWith('processed:')) {
      const match = line.match(/^processed:(.+):items=(\d+)$/)
      if (!match) continue
      const [, cnpj, countText] = match
      assignByCnpj(cnpj, (entry) => {
        const count = Number(countText)
        entry.resultCount = count
        entry.status = count > 0 ? 'DONE_WITH_RESULTS' : 'DONE_NO_RESULTS'
      })
    }
  }

  const failedMessage = logs.find((line) => line.startsWith('failed:'))
  if (failedMessage) {
    for (const entry of progressMap.values()) {
      if (entry.status === 'RUNNING') {
        entry.status = 'FAILED'
      }
    }
  }

  return trackedItems
    .map((item) => progressMap.get(item.id))
    .filter((entry): entry is TrackedProgressItem => Boolean(entry))
}

function getProgressBadgeVariant(status: TrackedProgressItem['status']) {
  switch (status) {
    case 'DONE_WITH_RESULTS':
      return 'default'
    case 'DONE_NO_RESULTS':
      return 'secondary'
    case 'FAILED':
      return 'destructive'
    case 'RUNNING':
      return 'secondary'
    default:
      return 'outline'
  }
}

function getProgressLabel(status: TrackedProgressItem['status']) {
  switch (status) {
    case 'RUNNING':
      return 'Consultando agora'
    case 'DONE_WITH_RESULTS':
      return 'Com resultado'
    case 'DONE_NO_RESULTS':
      return 'Sem resultado'
    case 'FAILED':
      return 'Falhou'
    default:
      return 'Aguardando'
  }
}

export default function TrackedCnpjsPage() {
  const [cnpjs, setCnpjs] = useState<TrackedCnpj[]>([])
  const [runs, setRuns] = useState<SearchRun[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [triggeringRun, setTriggeringRun] = useState(false)
  const [cancellingRun, setCancellingRun] = useState(false)
  const [editingItem, setEditingItem] = useState<TrackedCnpj | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showRunStatus, setShowRunStatus] = useState(true)
  const [showFullLogs, setShowFullLogs] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [formState, setFormState] = useState({
    cnpj: '',
    name: '',
    employerUnionName: '',
    employerUnionCnpj: '',
    laborUnionName: '',
    laborUnionCnpj: '',
    baseMonth: '',
  })
  const [batchInput, setBatchInput] = useState('')

  async function fetchCnpjs() {
    setLoading(true)
    try {
      const { data } = await api.get('/tracked-cnpjs')
      setCnpjs(data)
    } catch {
      toast.error('Erro ao carregar CNPJs')
    } finally {
      setLoading(false)
    }
  }

  async function fetchRuns() {
    try {
      const { data } = await api.get('/scraper/runs')
      setRuns(data)
    } catch {
      toast.error('Erro ao carregar execucoes')
    }
  }

  useEffect(() => {
    fetchCnpjs()
    fetchRuns()
  }, [])

  useEffect(() => {
    const hasRunning = runs.some((run) => run.status === 'RUNNING')
    if (!hasRunning) return

    const interval = window.setInterval(() => {
      fetchRuns()
      fetchCnpjs()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [runs])

  function resetDialog() {
    setDialogOpen(false)
    setEditingItem(null)
    setFormState({
      cnpj: '',
      name: '',
      employerUnionName: '',
      employerUnionCnpj: '',
      laborUnionName: '',
      laborUnionCnpj: '',
      baseMonth: '',
    })
    setBatchMode(false)
    setBatchInput('')
  }

  function openCreateDialog() {
    setEditingItem(null)
    setFormState({
      cnpj: '',
      name: '',
      employerUnionName: '',
      employerUnionCnpj: '',
      laborUnionName: '',
      laborUnionCnpj: '',
      baseMonth: '',
    })
    setDialogOpen(true)
  }

  function handleEdit(item: TrackedCnpj) {
    setEditingItem(item)
    setFormState({
      cnpj: item.employerUnionCnpj ?? item.cnpj,
      name: item.employerUnionName ?? item.name ?? '',
      employerUnionName: item.employerUnionName ?? item.name ?? '',
      employerUnionCnpj: item.employerUnionCnpj ?? item.cnpj,
      laborUnionName: item.laborUnionName ?? '',
      laborUnionCnpj: item.laborUnionCnpj ?? '',
      baseMonth: item.baseMonth ?? '',
    })
    setDialogOpen(true)
  }

  async function handleToggle(item: TrackedCnpj) {
    try {
      await api.put(`/tracked-cnpjs/${item.id}`, { isActive: !item.isActive })
      toast.success(`CNPJ ${item.isActive ? 'pausado' : 'reativado'} com sucesso`)
      fetchCnpjs()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      if (batchMode && !editingItem) {
        const rows = batchInput
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)

        const parsedItems = rows
          .map((line) => {
            const columns = line.includes('\t')
              ? line.split('\t').map((part) => part.trim())
              : line.split(/[;,]/).map((part) => part.trim())
            const [
              laborUnionName,
              laborUnionCnpj,
              employerUnionName,
              employerUnionCnpj,
              baseMonth,
            ] = columns
            const parsedEmployerUnionCnpj = (employerUnionCnpj ?? columns[0] ?? '').replace(/\D/g, '')
            return {
              cnpj: parsedEmployerUnionCnpj,
              name: employerUnionName || undefined,
              employerUnionName: employerUnionName || undefined,
              employerUnionCnpj: parsedEmployerUnionCnpj,
              laborUnionName: laborUnionName || undefined,
              laborUnionCnpj: (laborUnionCnpj ?? '').replace(/\D/g, '') || undefined,
              baseMonth: baseMonth || undefined,
            }
          })
          .filter((item) => item.cnpj.length === 14)

        if (parsedItems.length === 0) {
          toast.error('Nenhum CNPJ valido encontrado na lista')
          return
        }

        const results = await Promise.allSettled(
          parsedItems.map((item) => api.post('/tracked-cnpjs', item)),
        )

        const successCount = results.filter((result) => result.status === 'fulfilled').length
        const failedCount = results.length - successCount

        if (successCount > 0) {
          toast.success(`${successCount} CNPJ(s) adicionados com sucesso`)
        }
        if (failedCount > 0) {
          toast.error(`${failedCount} CNPJ(s) nao puderam ser adicionados`)
        }

        resetDialog()
        fetchCnpjs()
        return
      }

      const payload = {
        cnpj: formState.employerUnionCnpj.replace(/\D/g, '') || formState.cnpj.replace(/\D/g, ''),
        name: formState.employerUnionName || formState.name || undefined,
        employerUnionName: formState.employerUnionName || formState.name || undefined,
        employerUnionCnpj: formState.employerUnionCnpj.replace(/\D/g, '') || formState.cnpj.replace(/\D/g, '') || undefined,
        laborUnionName: formState.laborUnionName || undefined,
        laborUnionCnpj: formState.laborUnionCnpj.replace(/\D/g, '') || undefined,
        baseMonth: formState.baseMonth || undefined,
      }

      if (editingItem) {
        await api.put(`/tracked-cnpjs/${editingItem.id}`, payload)
        toast.success('CNPJ atualizado com sucesso!')
      } else {
        await api.post('/tracked-cnpjs', payload)
        toast.success('CNPJ adicionado com sucesso!')
      }

      resetDialog()
      fetchCnpjs()
    } catch {
      toast.error(editingItem ? 'Erro ao atualizar CNPJ' : 'Erro ao adicionar CNPJ')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: TrackedCnpj) {
    const confirmed = window.confirm(`Deseja excluir o CNPJ ${item.cnpj}?`)
    if (!confirmed) return

    setBusyId(item.id)
    try {
      await api.delete(`/tracked-cnpjs/${item.id}`)
      toast.success('CNPJ excluido com sucesso')
      fetchCnpjs()
    } catch {
      toast.error('Erro ao excluir CNPJ')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRun() {
    setTriggeringRun(true)
    try {
      await api.post('/scraper/runs')
      toast.success('Varredura iniciada com sucesso!')
      fetchRuns()
    } catch {
      toast.error('Erro ao iniciar varredura')
    } finally {
      setTriggeringRun(false)
    }
  }

  async function handleCancelRun() {
    if (!latestRun || latestRun.status !== 'RUNNING') return

    const confirmed = window.confirm('Deseja interromper a varredura em andamento?')
    if (!confirmed) return

    setCancellingRun(true)
    try {
      await api.post(`/scraper/runs/${latestRun.id}/cancel`)
      toast.success('Varredura interrompida com sucesso')
      fetchRuns()
      fetchCnpjs()
    } catch {
      toast.error('Erro ao interromper a varredura')
    } finally {
      setCancellingRun(false)
    }
  }

  const formatDate = (d: string) => new Date(d).toLocaleString('pt-BR')
  const latestRun = runs[0]
  const hasRunning = runs.some((run) => run.status === 'RUNNING')
  const latestLogs = latestRun?.logs?.split('\n').filter(Boolean) ?? []
  const latestRunInfo = parseRunLogs(latestLogs)
  const trackedProgress = parseTrackedProgress(latestLogs, cnpjs)
  const displayedLogs = showFullLogs ? latestLogs : latestLogs.slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">CNPJs Monitorados</h2>
          <p className="text-muted-foreground mt-1">Gerencie as empresas acompanhadas no Mediador MTE.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="font-semibold"
            onClick={handleRun}
            disabled={triggeringRun || hasRunning}
          >
            {triggeringRun || hasRunning ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Varredura em andamento</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Executar varredura</>
            )}
          </Button>
          <Button className="font-semibold" onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" /> Adicionar CNPJ
          </Button>
        </div>
      </div>

      <Card className="border-border/60 bg-card/80">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg font-heading">Status da Varredura</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setShowRunStatus((current) => !current)}>
            {showRunStatus ? 'Mostrar menos' : 'Mostrar mais'}
          </Button>
        </CardHeader>
        {showRunStatus && (
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={latestRun?.status === 'FAILED' ? 'destructive' : latestRun?.status === 'SUCCESS' ? 'default' : 'secondary'}>
                    {latestRun?.status === 'RUNNING'
                      ? 'Em execucao'
                      : latestRunInfo.isCancelled
                        ? 'Cancelada'
                      : latestRun?.status === 'SUCCESS'
                        ? 'Concluida'
                        : latestRun?.status === 'FAILED'
                          ? 'Falhou'
                          : 'Sem execucao'}
                </Badge>
                {latestRun?.startedAt && (
                  <span className="text-sm text-muted-foreground">
                    Inicio: {formatDate(latestRun.startedAt)}
                  </span>
                )}
                {latestRun?.finishedAt && latestRun.status !== 'RUNNING' && (
                  <span className="text-sm text-muted-foreground">
                    Fim: {formatDate(latestRun.finishedAt)}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{latestRunInfo.summary}</p>
            </div>
            <div className="flex gap-2">
              {hasRunning && latestRun?.status === 'RUNNING' && (
                <Button
                  variant="destructive"
                  onClick={handleCancelRun}
                  disabled={cancellingRun}
                >
                  {cancellingRun ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Parando...</>
                  ) : (
                    'Parar varredura'
                  )}
                </Button>
              )}
              <Button variant="ghost" onClick={() => { fetchRuns(); fetchCnpjs() }}>
                <RefreshCw className="w-4 h-4 mr-2" /> Atualizar status
              </Button>
            </div>
          </div>
          {latestRunInfo.isPortalFailure && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Falha externa no portal do MTE</p>
              <p className="mt-1 text-muted-foreground">
                A consulta foi enviada corretamente, mas o portal do MTE respondeu com erro interno
                {latestRunInfo.ajaxAttempts ? ` apos ${latestRunInfo.ajaxAttempts} tentativa(s)` : ''}.
                Tente novamente mais tarde.
              </p>
              {latestRunInfo.debugPath && (
                <p className="mt-2 font-mono text-xs text-muted-foreground break-all">
                  Debug local: {latestRunInfo.debugPath}
                </p>
              )}
            </div>
          )}
          {trackedProgress.length > 0 && (
            <div className="rounded-lg border bg-background/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Acompanhamento por dupla sindical</p>
                <span className="text-xs text-muted-foreground">
                  {trackedProgress.filter((item) => item.status === 'RUNNING').length > 0
                    ? 'Atualiza automaticamente durante a varredura'
                    : `${trackedProgress.filter((item) => item.status !== 'PENDING').length} de ${trackedProgress.length} processadas`}
                </span>
              </div>
              <div className="space-y-2">
                {trackedProgress.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.secondaryLabel}</p>
                    </div>
                    <div className="flex items-center gap-2 self-start md:self-center">
                      <Badge variant={getProgressBadgeVariant(item.status)}>
                        {getProgressLabel(item.status)}
                      </Badge>
                      {item.resultCount !== null && (
                        <span className="text-xs text-muted-foreground">
                          {item.resultCount} resultado(s)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-background/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Log da ultima execucao</p>
              {latestLogs.length > 8 && (
                <Button variant="ghost" size="sm" onClick={() => setShowFullLogs((current) => !current)}>
                  {showFullLogs ? 'Mostrar menos' : 'Mostrar mais'}
                </Button>
              )}
            </div>
            {latestLogs.length > 0 ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {displayedLogs.join('\n')}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">Sem logs ainda.</p>
            )}
          </div>
          {runs.length > 1 && (
            <div className="rounded-lg border bg-background/60 p-3">
              <p className="mb-2 text-sm font-medium">Historico recente</p>
              <div className="space-y-2">
                {runs.slice(0, 5).map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">{formatDate(run.startedAt)}</span>
                    <Badge variant={run.status === 'FAILED' ? 'destructive' : run.status === 'SUCCESS' ? 'default' : 'secondary'}>
                      {run.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : cnpjs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
          <Briefcase className="w-12 h-12 opacity-30" />
          <p className="text-lg font-medium">Nenhum CNPJ cadastrado</p>
          <p className="text-sm">Adicione um CNPJ para iniciar o monitoramento.</p>
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" /> Adicionar CNPJ
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {cnpjs.map((item) => (
            <Card key={item.id} className="relative overflow-hidden group">
              {!item.isActive && (
                <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] z-10 rounded-lg" />
              )}
              <CardHeader className="pb-3 border-b border-border/50 bg-muted/20 relative z-20">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <Badge variant={item.isActive ? 'default' : 'secondary'}>
                    {item.isActive ? 'Ativo' : 'Pausado'}
                  </Badge>
                </div>
                <CardTitle className="text-xl font-heading">
                  {item.employerUnionName || item.name || 'Sindicato patronal sem nome'}
                </CardTitle>
                <div className="text-sm font-mono text-muted-foreground">
                  {item.employerUnionCnpj || item.cnpj}
                </div>
              </CardHeader>
              <CardContent className="pt-4 relative z-20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Activity className="w-4 h-4" />
                  Atualizado: <span className="font-medium text-foreground">{formatDate(item.updatedAt)}</span>
                </div>
                {(item.employerUnionName || item.laborUnionName) && (
                  <div className="mb-4 space-y-2 rounded-lg border bg-background/60 p-3 text-xs">
                    {item.employerUnionName && (
                      <div>
                        <p className="font-medium text-foreground">Sindicato Patronal</p>
                        <p className="text-muted-foreground">{item.employerUnionName}</p>
                        {item.employerUnionCnpj && (
                          <p className="font-mono text-muted-foreground">{item.employerUnionCnpj}</p>
                        )}
                      </div>
                    )}
                    {item.laborUnionName && (
                      <div>
                        <p className="font-medium text-foreground">Sindicato Laboral</p>
                        <p className="text-muted-foreground">{item.laborUnionName}</p>
                        {item.laborUnionCnpj && (
                          <p className="font-mono text-muted-foreground">{item.laborUnionCnpj}</p>
                        )}
                      </div>
                    )}
                    {item.baseMonth && (
                      <div>
                        <p className="font-medium text-foreground">Data-base</p>
                        <p className="text-muted-foreground">{item.baseMonth}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => handleEdit(item)}>
                    Editar
                  </Button>
                  <Button
                    variant={item.isActive ? 'secondary' : 'default'}
                    className="flex-1"
                    onClick={() => handleToggle(item)}
                  >
                    {item.isActive ? 'Pausar' : 'Retomar'}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="mt-2 w-full text-destructive hover:text-destructive"
                  onClick={() => handleDelete(item)}
                  disabled={busyId === item.id}
                >
                  {busyId === item.id ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Excluindo...</>
                  ) : (
                    <><Trash2 className="w-4 h-4 mr-2" /> Excluir</>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open) resetDialog()
        else setDialogOpen(true)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {editingItem ? 'Editar Dupla Sindical' : 'Adicionar Dupla Sindical'}
            </DialogTitle>
            <DialogDescription>
              {editingItem
                ? 'Atualize os dados principais da dupla sindical usada no monitoramento.'
                : 'Cadastre sindicato patronal e sindicato laboral para iniciar o monitoramento.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {!editingItem && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={batchMode ? 'outline' : 'default'}
                  className="flex-1"
                  onClick={() => setBatchMode(false)}
                >
                  Cadastro unico
                </Button>
                <Button
                  type="button"
                  variant={batchMode ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setBatchMode(true)}
                >
                  Lista em lote
                </Button>
              </div>
            )}
            {batchMode && !editingItem ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Lista de CNPJs</label>
                <textarea
                  className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={'Cole as 5 colunas da planilha\nSindicato laboral<TAB>CNPJ laboral<TAB>Sindicato patronal<TAB>CNPJ patronal<TAB>Data-base'}
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Aceita cola direta do Excel com 5 colunas: sindicato laboral, CNPJ laboral, sindicato patronal, CNPJ patronal e data-base.
                </p>
              </div>
            ) : (
              <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Sindicato Patronal <span className="text-destructive">*</span></label>
              <Input
                placeholder="Nome do sindicato patronal"
                value={formState.employerUnionName}
                onChange={(e) => setFormState({ ...formState, employerUnionName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">CNPJ do Sindicato Patronal <span className="text-destructive">*</span></label>
              <Input
                placeholder="00.000.000/0000-00"
                value={formState.employerUnionCnpj}
                onChange={(e) => setFormState({ ...formState, employerUnionCnpj: e.target.value, cnpj: e.target.value })}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Sindicato Laboral <span className="text-destructive">*</span></label>
              <Input
                placeholder="Nome do sindicato laboral"
                value={formState.laborUnionName}
                onChange={(e) => setFormState({ ...formState, laborUnionName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">CNPJ do Sindicato Laboral <span className="text-destructive">*</span></label>
              <Input
                placeholder="00.000.000/0000-00"
                value={formState.laborUnionCnpj}
                onChange={(e) => setFormState({ ...formState, laborUnionCnpj: e.target.value })}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mes da Data-base <span className="text-muted-foreground text-xs">(opcional)</span></label>
              <Input
                placeholder="Ex: marco, 03, abril"
                value={formState.baseMonth}
                onChange={(e) => setFormState({ ...formState, baseMonth: e.target.value })}
              />
            </div>
              </>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={resetDialog}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : editingItem ? 'Salvar' : batchMode ? 'Importar lista' : 'Adicionar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
