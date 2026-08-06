import { useEffect, useState } from 'react'
import { TIPOS, OBJETIVOS, buildSystem, buildPrompt } from './prompts.js'
import { DEMO } from './demoContent.js'

const CAMPOS = [
  { id: 'nome', label: 'Seu nome', ph: 'Dr(a). ...' },
  { id: 'especialidade', label: 'Especialidade', ph: 'Ex: Cardiologia, Dermatologia...' },
  { id: 'cidade', label: 'Cidade', ph: 'Ex: São Paulo - SP' },
  { id: 'publico', label: 'Público-alvo', ph: 'Ex: mulheres 35-55 anos, executivos, atletas...' },
  { id: 'posicionamento', label: 'Posicionamento', ph: 'Como você quer ser percebido(a)? Ex: referência em medicina preventiva' },
  { id: 'servicos', label: 'Principais serviços', ph: 'Ex: consulta, check-up executivo, programa de emagrecimento...' },
  { id: 'ticket', label: 'Ticket médio', ph: 'Ex: R$ 600 a consulta / R$ 5.000 o programa' },
  { id: 'diferenciais', label: 'Diferenciais', ph: 'O que só você oferece? Tempo de consulta, tecnologia, acompanhamento...' },
]

const TONS = ['Próximo e acolhedor', 'Direto e provocador', 'Técnico e autoridade', 'Leve e bem-humorado']

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

export default function App() {
  const [profile, setProfile] = useState(() => load('mg_profile', null))
  const [form, setForm] = useState(() => load('mg_profile', { tom: TONS[0] }) || { tom: TONS[0] })
  const [knowledge, setKnowledge] = useState(null)
  const [tipo, setTipo] = useState('carrossel')
  const [tema, setTema] = useState('')
  const [objetivo, setObjetivo] = useState(OBJETIVOS[1])
  const [saida, setSaida] = useState(null)
  const [gerando, setGerando] = useState(false)
  const [demo, setDemo] = useState(false)
  const [historico, setHistorico] = useState(() => load('mg_historico', []))
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    fetch('/api/knowledge').then(r => r.json()).then(setKnowledge).catch(() => {})
  }, [])

  function salvarPerfil(e) {
    e.preventDefault()
    localStorage.setItem('mg_profile', JSON.stringify(form))
    setProfile(form)
    setEditando(false)
  }

  async function gerar() {
    if (!tema.trim() && tipo !== 'pautas') return
    setGerando(true)
    setSaida(null)
    setDemo(false)
    const temaFinal = tema.trim() || `temas gerais de ${profile.especialidade}`
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildSystem(profile, knowledge),
          prompt: buildPrompt(tipo, temaFinal, objetivo),
        }),
      })
      const data = await r.json()
      let texto
      if (r.status === 503 && data.error === 'no_api_key') {
        texto = DEMO[tipo]
        setDemo(true)
      } else if (!r.ok || data.error) {
        texto = `**Erro ao gerar:** ${data.error || r.status}. Tente novamente.`
      } else {
        texto = data.text
      }
      setSaida(texto)
      const item = { tipo, tema: temaFinal, objetivo, texto, data: new Date().toISOString() }
      const novo = [item, ...historico].slice(0, 50)
      setHistorico(novo)
      localStorage.setItem('mg_historico', JSON.stringify(novo))
    } catch (e) {
      setSaida(`**Erro de conexão:** ${e.message}`)
    }
    setGerando(false)
  }

  if (!profile || editando) {
    return (
      <div className="onboarding">
        <div className="onb-card">
          <div className="logo">Med<span>Growth</span></div>
          <h1>Sua IA de marketing e vendas</h1>
          <p className="sub">Quanto mais preciso o perfil, mais o conteúdo vende. Preencha uma vez — a IA personaliza tudo para o SEU consultório.</p>
          <form onSubmit={salvarPerfil}>
            {CAMPOS.map(c => (
              <label key={c.id}>
                {c.label}
                <input
                  required
                  value={form[c.id] || ''}
                  placeholder={c.ph}
                  onChange={e => setForm({ ...form, [c.id]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Tom de voz
              <select value={form.tom} onChange={e => setForm({ ...form, tom: e.target.value })}>
                {TONS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-primary">Começar a gerar conteúdo →</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="layout">
      <aside>
        <div className="logo">Med<span>Growth</span></div>
        <div className="perfil-mini">
          <strong>{profile.nome}</strong>
          <small>{profile.especialidade} · {profile.cidade}</small>
          <button className="link" onClick={() => { setForm(profile); setEditando(true) }}>editar perfil</button>
          <a className="link" href="/vendas.html">página de vendas ↗</a>
        </div>
        <nav>
          {TIPOS.map(t => (
            <button
              key={t.id}
              className={tipo === t.id ? 'nav-item ativo' : 'nav-item'}
              onClick={() => { setTipo(t.id); setSaida(null) }}
            >
              <strong>{t.label}</strong>
              <small>{t.desc}</small>
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header>
          <h2>{TIPOS.find(t => t.id === tipo).label}</h2>
          {knowledge && Object.keys(knowledge).length > 0 && (
            <span className="badge ok">base de conhecimento ativa</span>
          )}
        </header>

        <div className="gerador">
          <input
            className="tema"
            value={tema}
            placeholder={tipo === 'pautas' ? 'Tema da semana (opcional)' : 'Sobre o quê? Ex: ansiedade e coração, check-up anual, seu programa premium...'}
            onChange={e => setTema(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && gerar()}
          />
          <select value={objetivo} onChange={e => setObjetivo(e.target.value)}>
            {OBJETIVOS.map(o => <option key={o}>{o}</option>)}
          </select>
          <button className="btn-primary" onClick={gerar} disabled={gerando}>
            {gerando ? 'Gerando…' : '⚡ Gerar'}
          </button>
        </div>

        {demo && (
          <div className="aviso-demo">
            Modo demo: crie um arquivo <code>.env</code> com <code>ANTHROPIC_API_KEY=sua-chave</code> para geração real e personalizada.
          </div>
        )}

        {saida && (
          <article className="resultado">
            <div className="res-topo">
              <span>{new Date().toLocaleString('pt-BR')}</span>
              <button className="link" onClick={() => navigator.clipboard.writeText(saida)}>copiar</button>
            </div>
            <pre>{saida}</pre>
          </article>
        )}

        {!saida && !gerando && historico.length > 0 && (
          <section className="historico">
            <h3>Histórico</h3>
            {historico.slice(0, 8).map((h, i) => (
              <button key={i} className="hist-item" onClick={() => { setSaida(h.texto); setTipo(h.tipo) }}>
                <strong>{TIPOS.find(t => t.id === h.tipo)?.label}</strong> — {h.tema}
                <small>{new Date(h.data).toLocaleDateString('pt-BR')} · {h.objetivo}</small>
              </button>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
