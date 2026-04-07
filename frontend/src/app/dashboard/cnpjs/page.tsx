import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Plus, Briefcase, Activity } from "lucide-react"

export default function TrackedCnpjsPage() {
  const dummyCnpjs = [
    { id: 1, name: "Empresa XPTO", cnpj: "12.345.678/0001-90", active: true, lastRun: "Hoje às 00:05" },
    { id: 2, name: "Indústria ABC", cnpj: "98.765.432/0001-10", active: true, lastRun: "Hoje às 00:07" },
    { id: 3, name: "Comércio Delta", cnpj: "45.123.456/0001-20", active: false, lastRun: "05/04/2026" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">CNPJs Monitorados</h2>
          <p className="text-muted-foreground mt-1">Gerencie as empresas acompanhadas no Mediador MTE.</p>
        </div>
        <Button className="font-semibold"><Plus className="w-4 h-4 mr-2"/> Adicionar CNPJ</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dummyCnpjs.map(item => (
          <Card key={item.id} className="relative overflow-hidden group">
            {!item.active && <div className="absolute inset-0 bg-background/50 z-10 pointer-events-none"></div>}
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20 relative z-20">
              <div className="flex items-center justify-between mb-2">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Briefcase className="w-5 h-5"/>
                </div>
                <Badge variant={item.active ? 'default' : 'secondary'}>
                  {item.active ? 'Ativo' : 'Pausado'}
                </Badge>
              </div>
              <CardTitle className="text-xl font-heading">{item.name}</CardTitle>
              <div className="text-sm font-mono text-muted-foreground">{item.cnpj}</div>
            </CardHeader>
            <CardContent className="pt-4 relative z-20">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <Activity className="w-4 h-4" />
                Última varredura: <span className="font-medium text-foreground">{item.lastRun}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1">Editar</Button>
                <Button variant={item.active ? "secondary" : "default"} className="flex-1">
                  {item.active ? "Pausar" : "Retomar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
