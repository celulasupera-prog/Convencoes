'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Filter, Download, Loader2, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import { toast } from 'sonner'

interface InstrumentParty {
  id: string
  name: string
  cnpj?: string
  role: string
}

interface Instrument {
  id: string
  externalId: string
  type: string
  registerDate?: string
  validityStart?: string
  validityEnd?: string
  uf?: string
  documentLink?: string
  isNew: boolean
  parties: InstrumentParty[]
}

export default function Dashboard() {
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 9

  const fetchInstruments = useCallback(async (reset = false) => {
    setLoading(true)
    try {
      const currentPage = reset ? 0 : page
      const params: Record<string, string | number> = {
        skip: currentPage * PAGE_SIZE,
        take: PAGE_SIZE,
      }
      if (search.trim()) {
        params.cnpj = search.trim()
      }
      const { data } = await api.get('/instruments', { params })
      setInstruments(data.data)
      setTotal(data.total)
      if (reset) setPage(0)
    } catch {
      toast.error('Erro ao carregar instrumentos')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { fetchInstruments() }, [fetchInstruments])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    fetchInstruments(true)
  }

  const formatDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('pt-BR') : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">Biblioteca de Instrumentos</h2>
          <p className="text-muted-foreground mt-1">
            {loading ? 'Carregando...' : `${total} documento(s) encontrado(s)`}
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por CNPJ..."
            className="pl-9 bg-background focus-visible:ring-primary/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <Button type="submit" variant="outline" className="w-full sm:w-auto border-border hover:bg-muted">
            <Filter className="w-4 h-4 mr-2" /> Filtrar
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => toast.info('Exportação em breve!')}>
            <Download className="w-4 h-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : instruments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
          <Search className="w-12 h-12 opacity-30" />
          <p className="text-lg font-medium">Nenhum instrumento encontrado</p>
          <p className="text-sm">Execute uma varredura ou ajuste os filtros.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instruments.map((item) => (
              <Card key={item.id} className="group hover:border-primary/50 transition-all duration-300 overflow-hidden relative">
                {item.isNew && (
                  <div className="absolute top-0 right-0 w-12 h-12 bg-primary/10 flex items-center justify-center rounded-bl-3xl z-10">
                    <div className="w-2 h-2 rounded-full bg-primary animate-ping absolute" />
                    <div className="w-2 h-2 rounded-full bg-primary relative" />
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={item.isNew ? 'default' : 'secondary'} className="text-[10px] font-bold">
                      {item.isNew ? 'Novo' : 'Registrado'}
                    </Badge>
                    {item.uf && (
                      <Badge variant="outline" className="text-[10px]">{item.uf}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">{formatDate(item.registerDate)}</span>
                  </div>
                  <CardTitle className="text-lg font-heading">{item.type} — {item.externalId}</CardTitle>
                  <CardDescription className="text-sm">
                    {item.parties[0]?.name ?? 'Sem partes registradas'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground mb-4">
                    Vigência: {formatDate(item.validityStart)} → {formatDate(item.validityEnd)}
                  </div>
                  <div className="flex justify-end">
                    {item.documentLink ? (
                      <a href={item.documentLink} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <ExternalLink className="w-3 h-3 mr-1" /> Ver Documento
                        </Button>
                      </a>
                    ) : (
                      <Button variant="ghost" size="sm" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors" disabled>
                        Sem link
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">
              Página {page + 1} de {Math.ceil(total / PAGE_SIZE)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
