'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldAlert, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      toast.success('Login realizado com sucesso!')
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Credenciais inválidas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 relative bg-background">
      {/* Visual Side */}
      <div className="hidden lg:flex relative overflow-hidden bg-zinc-950 p-10 flex-col justify-between">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070')] bg-cover bg-center opacity-20 mix-blend-luminosity grayscale" />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
        <div className="relative z-10">
          <ShieldAlert className="w-12 h-12 text-primary" />
          <h1 className="mt-4 text-4xl font-heading font-light tracking-wider text-white">
            MTE <span className="font-bold text-primary">Monitor</span>
          </h1>
        </div>
        <div className="relative z-10 text-zinc-400 max-w-sm">
          <p className="text-lg">
            Automatize o monitoramento de CCTs e ACTs em larga escala com precisão absoluta.
          </p>
        </div>
      </div>

      {/* Login Side */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-md space-y-6">
          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <ShieldAlert className="w-10 h-10 text-primary mx-auto lg:hidden mb-4" />
            <h1 className="text-3xl font-heading font-bold tracking-tight">Bem-vindo de volta</h1>
            <p className="text-muted-foreground">Insira suas credenciais corporativas.</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none">Email</label>
              <Input
                id="email"
                type="email"
                placeholder="admin@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-muted/50 border-border focus-visible:ring-primary h-12"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium leading-none">Senha</label>
                <a href="#" className="text-xs font-semibold text-primary hover:underline">
                  Esqueceu a senha?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-muted/50 border-border focus-visible:ring-primary h-12"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 text-md font-bold transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-primary/20"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Entrando...</>
            ) : (
              'Acessar Painel'
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
