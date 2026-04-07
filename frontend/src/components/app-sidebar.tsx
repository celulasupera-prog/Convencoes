'use client'

import { Home, List, Briefcase, Settings, LogOut } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/auth-context'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const items = [
  { title: 'Biblioteca', url: '/dashboard', icon: List },
  { title: 'CNPJs Monitorados', url: '/dashboard/cnpjs', icon: Briefcase },
  { title: 'Configurações', url: '#', icon: Settings },
]

export function AppSidebar() {
  const { user, logout } = useAuth()

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'MTE'

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>MTE Premium</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <a href={item.url}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </a>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50 p-3">
        <div className="flex items-center gap-3 pb-2">
          <Avatar className="h-8 w-8 border border-primary/30">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || 'Usuário'}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.role || ''}</p>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-destructive hover:bg-destructive/10 hover:text-destructive w-full"
              onClick={logout}
            >
              <LogOut />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
