import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Filter, Download } from "lucide-react"

export default function Dashboard() {
  const dummyData = [
    { id: 1, cct: "CCT 2024/2025", cnpj: "12.345.678/0001-90", status: "Novo", date: "07/04/2026", uf: "SP" },
    { id: 2, cct: "ACT 2025/2026", cnpj: "98.765.432/0001-10", status: "Analisado", date: "05/04/2026", uf: "RJ" },
    { id: 3, cct: "CCT 2023/2024", cnpj: "45.123.456/0001-20", status: "Antigo", date: "12/03/2026", uf: "MG" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-heading font-bold tracking-tight">Biblioteca de Instrumentos</h2>
          <p className="text-muted-foreground mt-1">Navegue e pesquise os documentos MTE extraídos.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar CCT ou CNPJ..." className="pl-9 bg-background focus-visible:ring-primary/50" />
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <Button variant="outline" className="w-full sm:w-auto border-border hover:bg-muted"><Filter className="w-4 h-4 mr-2"/> Filtros</Button>
          <Button className="w-full sm:w-auto"><Download className="w-4 h-4 mr-2"/> Exportar CSV</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dummyData.map(item => (
          <Card key={item.id} className="group hover:border-primary/50 transition-all duration-300 overflow-hidden relative">
            {item.status === 'Novo' && (
              <div className="absolute top-0 right-0 w-12 h-12 bg-primary/10 flex items-center justify-center rounded-bl-3xl">
                <div className="w-2 h-2 rounded-full bg-primary animate-ping absolute" />
                <div className="w-2 h-2 rounded-full bg-primary relative" />
              </div>
            )}
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={item.status === 'Novo' ? 'default' : 'secondary'} className="text-[10px] font-bold">
                  {item.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{item.date}</span>
              </div>
              <CardTitle className="text-lg font-heading">{item.cct} - {item.uf}</CardTitle>
              <CardDescription className="text-sm">CNPJ: <span className="font-mono text-foreground">{item.cnpj}</span></CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end pt-2">
                <Button variant="ghost" size="sm" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  Visualizar Detalhes
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
