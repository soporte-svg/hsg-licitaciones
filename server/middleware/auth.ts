import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/supabase.js'

export const requireAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Token requerido' } }, 401)
  }

  const token = authHeader.slice(7)

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Token inválido' } }, 401)
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email ?? '')
  c.set('token', token)

  await next()
})

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    userEmail: string
    token: string
  }
}
