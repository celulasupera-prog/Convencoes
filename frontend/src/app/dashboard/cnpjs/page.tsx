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
import { Plus, Briefcase, Activity, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { toast } from 'sonner'

interface TrackedCnpj {
  id: string
  cnpj: string
  name?: string
  isActive: boolean
  updatedAt: string
}

export default function TrackedCnpjsPage() {
  const [cnpjs, setCnpjs] = useState<TrackedCnpj[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCnpj, setNewCnpj] = useState({ cnpj: '', name: '' })

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

  useEffect(() => { fetchCnpjs() }, [])

  async function handleToggle(item: TrackedCnpj) {
    try {
      await api.put(`/tracked-cnpjs/${item.id}`, { isActive: !item.isActive })
      toast.success(`CNPJ ${item.isActive ? 'pausado' : 'reativado'} com sucesso`)
      fetchCnpjs()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // For now, we need an organizationId — if the user has one in JWT we'd use it.
      // Using a placeholder until multi-org is wired in the UI.
      await api.post('/tracked-cnpjs', {
        cnpj: newCnpj.cnpj.replace(/\D/g, ''),
        name: newCnpj.name || undefined,
        organizationId: 'default', // will be replaced once org selection is added
      })
      toast.success('CNPJ adicionado com sucesso!')
      setDialogOpen(false)
      setNewCnpj({ cnpj: '', name: '' })
      fetchCnpjs()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao adicionar CNPJ')
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (d: string) => new Date(d).toLocaleString('pt-BR')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">CNPJs Monitorados</h2>
          <p className="text-muted-foreground mt-1">Gerencie as empresas acompanhadas no Mediador MTE.</p>
        </div>
        <Button className="font-semibold" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Adicionar CNPJ
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : cnpjs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
          <Briefcase className="w-12 h-12 opacity-30" />
          <p className="text-lg font-medium">Nenhum CNPJ cadastrado</p>
          <p className="text-sm">Adicione um CNPJ para iniciar o monitoramento.</p>
          <Button onClick={() => setDialogOpen(true)}>
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
                <CardTitle className="text-xl font-heading">{item.name || 'Sem nome'}</CardTitle>
                <div className="text-sm font-mono text-muted-foreground">{item.cnpj}</div>
              </CardHeader>
              <CardContent className="pt-4 relative z-20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Activity className="w-4 h-4" />
                  Atualizado: <span className="font-medium text-foreground">{formatDate(item.updatedAt)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled>Editar</Button>
                  <Button
                    variant={item.isActive ? 'secondary' : 'default'}
                    className="flex-1"
                    onClick={() => handleToggle(item)}
                  >
                    {item.isActive ? 'Pausar' : 'Retomar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add CNPJ Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Adicionar CNPJ</DialogTitle>
            <DialogDescription>
              Insira o CNPJ da empresa para iniciar o monitoramento automático.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">CNPJ <span className="text-destructive">*</span></label>
              <Input
                placeholder="00.000.000/0000-00"
                value={newCnpj.cnpj}
                onChange={(e) => setNewCnpj({ ...newCnpj, cnpj: e.target.value })}
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Empresa <span className="text-muted-foreground text-xs">(opcional)</span></label>
              <Input
                placeholder="Ex: Empresa XPTO S.A."
                value={newCnpj.name}
                onChange={(e) => setNewCnpj({ ...newCnpj, name: e.target.value })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : 'Adicionar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
