import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Endpoint /api/generate: chama a API da Anthropic com a chave do .env.
// Sem chave, o front cai automaticamente no modo demo.
function apiPlugin(env) {
  return {
    name: 'medgrowth-api',
    configureServer(server) {
      server.middlewares.use('/api/generate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ error: 'no_api_key' }))
        }
        let body = ''
        for await (const chunk of req) body += chunk
        const { system, prompt } = JSON.parse(body)
        try {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-5',
              max_tokens: 4000,
              system,
              messages: [{ role: 'user', content: prompt }],
            }),
          })
          const data = await r.json()
          res.statusCode = r.ok ? 200 : r.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text: data.content?.[0]?.text, error: data.error?.message }))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(e) }))
        }
      })

      // Serve os arquivos de pesquisa para enriquecer os prompts quando existirem
      server.middlewares.use('/api/knowledge', (req, res) => {
        const dir = path.resolve('research')
        const files = ['base-conhecimento.md', 'compliance-cfm.md']
        const out = {}
        for (const f of files) {
          const p = path.join(dir, f)
          if (fs.existsSync(p)) out[f] = fs.readFileSync(p, 'utf-8')
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(out))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiPlugin(env)],
    server: { port: 4520 },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve('index.html'),
          vendas: path.resolve('vendas.html'),
        },
      },
    },
  }
})
