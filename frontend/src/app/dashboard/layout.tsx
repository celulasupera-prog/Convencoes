import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 overflow-x-hidden flex flex-col">
        <header className="sticky top-0 z-10 flex border-b bg-background/80 backdrop-blur-md px-4 py-3 shrink-0 items-center justify-between">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-lg font-heading font-semibold ml-2">Painel de Controle</h1>
          </div>
          <div className="flex items-center gap-4">
             <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                <span className="text-xs font-bold text-primary">ADM</span>
             </div>
          </div>
        </header>
        <div className="p-4 md:p-8 flex-1 animate-in fade-in zoom-in-95 duration-500 ease-out">
          {children}
        </div>
      </main>
    </SidebarProvider>
  )
}
