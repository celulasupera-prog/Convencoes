'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import { useRouter } from 'next/navigation'
import Cookies from 'js-cookie'

interface User {
  id: string
  name: string
  email: string
  role: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const storedToken = localStorage.getItem('mte_token')
    const storedUser = localStorage.getItem('mte_user')
    if (storedToken && storedUser) {
      setToken(storedToken)
      setUser(JSON.parse(storedUser))
      // Ensure cookie is also set if missing (e.g. after refresh)
      if (!Cookies.get('mte_token')) {
        Cookies.set('mte_token', storedToken, { expires: 7 })
      }
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password })
    
    localStorage.setItem('mte_token', data.access_token)
    localStorage.setItem('mte_user', JSON.stringify(data.user))
    // Set cookie for middleware
    Cookies.set('mte_token', data.access_token, { expires: 7 })
    
    setToken(data.access_token)
    setUser(data.user)
    router.push('/dashboard')
  }, [router])

  const logout = useCallback(() => {
    localStorage.removeItem('mte_token')
    localStorage.removeItem('mte_user')
    Cookies.remove('mte_token')
    setToken(null)
    setUser(null)
    router.push('/')
  }, [router])

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
