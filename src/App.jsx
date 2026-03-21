import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts'
import { hasSupabaseEnv, supabase } from './lib/supabase'

const MONTHS = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Noi','Dec']
const EXPENSE_CATEGORIES = ['Benzinărie','Cheltuieli adiționale','Cadouri','Mâncare','Casă','Transport','Facturi','Întreținere auto','Sănătate','Altele']
const INCOME_CATEGORIES = ['Salariu','Vânzări','Bonus','Restituire','Altele']
const APP_PIN_KEY = 'buget-pro-local-pin'
const APP_SETTINGS_KEY = 'buget-pro-local-settings'

const emptyForm = {
  date: new Date().toISOString().slice(0,10),
  description: '',
  category: 'Benzinărie',
  amount: '',
  type: 'expense',
  recurring: false,
}

function formatMDL(value) {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'MDL', maximumFractionDigits: 0 }).format(Number(value || 0))
}
function getMonthKey(date) { return String(date).slice(0, 7) }
function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  return `${MONTHS[Number(month)-1]} ${year}`
}
function toCsv(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"','""')}"`).join(',')).join('\n')
}
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState({ expenses: EXPENSE_CATEGORIES, incomes: INCOME_CATEGORIES })
  const [budgets, setBudgets] = useState({})
  const [savingsGoal, setSavingsGoal] = useState(50000)
  const [pinState, setPinState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(APP_PIN_KEY)) || { enabled: false, code: '1234', unlocked: true, input: '' } } catch { return { enabled: false, code: '1234', unlocked: true, input: '' } }
  })
  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)) || { appName: 'Buget Pro', proMode: true, overBudgetAlerts: true, smartInsights: true }
    } catch {
      return { appName: 'Buget Pro', proMode: true, overBudgetAlerts: true, smartInsights: true }
    }
  })
  const [tab, setTab] = useState('dashboard')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [newCategory, setNewCategory] = useState('')
  const [newCategoryType, setNewCategoryType] = useState('expense')
  const [filters, setFilters] = useState({ q: '', type: 'all', month: 'all' })
  const [message, setMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    localStorage.setItem(APP_PIN_KEY, JSON.stringify(pinState))
  }, [pinState])
  useEffect(() => {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!hasSupabaseEnv) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) loadAll()
  }, [session])

  async function loadAll() {
    const [txRes, profileRes, catRes] = await Promise.all([
      supabase.from('transactions').select('*').order('date', { ascending: false }),
      supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('categories').select('*').eq('user_id', session.user.id),
    ])
    if (!txRes.error) setTransactions(txRes.data || [])
    if (!profileRes.error && profileRes.data) {
      setBudgets(profileRes.data.budget_by_month || {})
      setSavingsGoal(profileRes.data.savings_goal || 50000)
      setSettings((prev) => ({ ...prev, appName: profileRes.data.app_name || prev.appName }))
    }
    if (!catRes.error && catRes.data?.length) {
      setCategories({
        expenses: catRes.data.filter((x) => x.type === 'expense').map((x) => x.name),
        incomes: catRes.data.filter((x) => x.type === 'income').map((x) => x.name),
      })
    }
  }

  async function ensureProfileAndCategories() {
    if (!session) return
    await supabase.from('profiles').upsert({
      user_id: session.user.id,
      budget_by_month: budgets,
      savings_goal: savingsGoal,
      app_name: settings.appName,
    }, { onConflict: 'user_id' })

    const payload = [
      ...categories.expenses.map((name) => ({ user_id: session.user.id, name, type: 'expense' })),
      ...categories.incomes.map((name) => ({ user_id: session.user.id, name, type: 'income' })),
    ]
    await supabase.from('categories').upsert(payload, { onConflict: 'user_id,name,type' })
  }

  useEffect(() => {
    if (session) ensureProfileAndCategories()
  }, [session, budgets, savingsGoal, categories, settings.appName])

  const monthlyData = useMemo(() => {
    const map = {}
    for (const tx of transactions) {
      const month = getMonthKey(tx.date)
      if (!map[month]) map[month] = { month, label: getMonthLabel(month), income: 0, expense: 0, budget: Number(budgets[month] || 0) }
      if (tx.type === 'income') map[month].income += Number(tx.amount)
      else map[month].expense += Number(tx.amount)
    }
    return Object.values(map).sort((a,b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, balance: m.income - m.expense }))
  }, [transactions, budgets])

  const annualData = useMemo(() => {
    const map = {}
    for (const tx of transactions) {
      const year = String(tx.date).slice(0,4)
      if (!map[year]) map[year] = { year, income: 0, expense: 0 }
      if (tx.type === 'income') map[year].income += Number(tx.amount)
      else map[year].expense += Number(tx.amount)
    }
    return Object.values(map).sort((a,b) => a.year.localeCompare(b.year)).map((y) => ({ ...y, balance: y.income - y.expense }))
  }, [transactions])

  const expenseCategoryData = useMemo(() => {
    const map = {}
    for (const tx of transactions.filter((t) => t.type === 'expense')) map[tx.category] = (map[tx.category] || 0) + Number(tx.amount)
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value)
  }, [transactions])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const q = [tx.description, tx.category, tx.date].join(' ').toLowerCase().includes(filters.q.toLowerCase())
      const t = filters.type === 'all' || tx.type === filters.type
      const m = filters.month === 'all' || getMonthKey(tx.date) === filters.month
      return q && t && m
    })
  }, [transactions, filters])

  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const totalBalance = totalIncome - totalExpense
  const currentMonth = new Date().toISOString().slice(0,7)
  const currentMonthData = monthlyData.find((m) => m.month === currentMonth) || { income:0, expense:0, balance:0, budget:0 }
  const savingsProgress = savingsGoal > 0 ? Math.min(100, Math.round(Math.max(totalBalance, 0) / savingsGoal * 100)) : 0
  const avgExpense = monthlyData.length ? monthlyData.reduce((s,m)=>s+m.expense,0) / monthlyData.length : 0
  const monthOptions = [...new Set(transactions.map((t) => getMonthKey(t.date)))].sort()

  const smartInsights = useMemo(() => {
    if (!settings.smartInsights) return []
    const items = []
    if (currentMonthData.budget && currentMonthData.expense > currentMonthData.budget) items.push(`Ai depășit bugetul lunii curente cu ${formatMDL(currentMonthData.expense - currentMonthData.budget)}.`)
    const top = expenseCategoryData[0]
    if (top) items.push(`Cea mai mare categorie de cheltuieli este ${top.name}: ${formatMDL(top.value)}.`)
    if (monthlyData.length >= 2) {
      const last = monthlyData.at(-1)
      const prev = monthlyData.at(-2)
      if (last && prev && last.expense > prev.expense) items.push(`Cheltuielile din ultima lună au crescut față de luna anterioară cu ${formatMDL(last.expense - prev.expense)}.`)
    }
    if (totalBalance > 0) items.push(`Sold pozitiv actual: ${formatMDL(totalBalance)}.`)
    return items.slice(0, 4)
  }, [settings.smartInsights, currentMonthData, expenseCategoryData, monthlyData, totalBalance])

  async function handleAuthSubmit(e) {
    e.preventDefault()
    if (!hasSupabaseEnv) return setMessage('Adaugă VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY în fișierul .env.')
    const payload = authMode === 'login'
  ? { email: authForm.email, password: authForm.password }
  : { 
      email: authForm.email, 
      password: authForm.password, 
      options: { emailRedirectTo: window.location.origin } 
    }

let error

if (authMode === 'login') {
  const res = await supabase.auth.signInWithPassword(payload)
  error = res.error
} else {
  const res = await supabase.auth.signUp(payload)
  error = res.error
}
    setMessage(error ? error.message : authMode === 'login' ? 'Autentificat.' : 'Cont creat. Verifică emailul dacă Supabase cere confirmare.')
  }

  async function handleLogout() {
    if (!hasSupabaseEnv) return
    await supabase.auth.signOut()
    setTransactions([])
  }

  async function saveTransaction(e) {
    e.preventDefault()
    if (!session) return
    const payload = {
      user_id: session.user.id,
      date: form.date,
      description: form.description,
      category: form.category,
      amount: Number(form.amount),
      type: form.type,
      recurring: form.recurring,
    }
    const res = editingId
      ? await supabase.from('transactions').update(payload).eq('id', editingId).eq('user_id', session.user.id)
      : await supabase.from('transactions').insert(payload)
    if (res.error) return setMessage(res.error.message)
    setMessage(editingId ? 'Tranzacție actualizată.' : 'Tranzacție adăugată.')
    setForm(emptyForm)
    setEditingId(null)
    loadAll()
  }

  function startEdit(tx) {
    setEditingId(tx.id)
    setForm({ date: tx.date, description: tx.description, category: tx.category, amount: String(tx.amount), type: tx.type, recurring: tx.recurring })
  }

  async function deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', session.user.id)
    setMessage(error ? error.message : 'Tranzacție ștearsă.')
    loadAll()
  }

  async function saveBudget(month, value) {
    const next = { ...budgets, [month]: value }
    setBudgets(next)
    await supabase.from('profiles').upsert({ user_id: session.user.id, budget_by_month: next, savings_goal: savingsGoal, app_name: settings.appName }, { onConflict: 'user_id' })
  }

  async function addCategory() {
    const value = newCategory.trim()
    if (!value || !session) return
    if (newCategoryType === 'expense' && categories.expenses.includes(value)) return
    if (newCategoryType === 'income' && categories.incomes.includes(value)) return
    const payload = { user_id: session.user.id, name: value, type: newCategoryType }
    const { error } = await supabase.from('categories').insert(payload)
    if (!error) {
      setCategories((prev) => newCategoryType === 'expense' ? { ...prev, expenses: [...prev.expenses, value] } : { ...prev, incomes: [...prev.incomes, value] })
      setNewCategory('')
    }
  }

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    setInstallPrompt(null)
  }

  function exportTransactionsCsv() {
    const rows = [['Data','Tip','Descriere','Categorie','Suma','Recurent'], ...transactions.map((t) => [t.date,t.type,t.description,t.category,t.amount,t.recurring ? 'Da':'Nu'])]
    downloadFile(toCsv(rows), 'tranzactii.csv', 'text/csv;charset=utf-8;')
  }
  function exportMonthlyCsv() {
    const rows = [['Luna','Venituri','Cheltuieli','Sold','Buget'], ...monthlyData.map((m) => [m.label,m.income,m.expense,m.balance,m.budget])]
    downloadFile(toCsv(rows), 'raport-lunar.csv', 'text/csv;charset=utf-8;')
  }
  function exportBackup() {
    downloadFile(JSON.stringify({ transactions, categories, budgets, savingsGoal, settings }, null, 2), 'backup-buget-pro.json', 'application/json')
  }
  function exportPrintableReport() {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Raport Buget Pro</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}th{background:#f8fafc}.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}.card{border:1px solid #ddd;border-radius:12px;padding:12px}</style></head><body><h1>${settings.appName}</h1><div class="cards"><div class="card">Venit total<br><strong>${formatMDL(totalIncome)}</strong></div><div class="card">Cheltuieli totale<br><strong>${formatMDL(totalExpense)}</strong></div><div class="card">Sold total<br><strong>${formatMDL(totalBalance)}</strong></div><div class="card">Obiectiv economii<br><strong>${savingsProgress}%</strong></div></div><table><thead><tr><th>Luna</th><th>Venituri</th><th>Cheltuieli</th><th>Sold</th><th>Buget</th></tr></thead><tbody>${monthlyData.map((m)=>`<tr><td>${m.label}</td><td>${formatMDL(m.income)}</td><td>${formatMDL(m.expense)}</td><td>${formatMDL(m.balance)}</td><td>${formatMDL(m.budget)}</td></tr>`).join('')}</tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  if (!hasSupabaseEnv) {
    return <AuthShell title="Lipsește configurarea Supabase"><p className="subtitle">Copiază fișierul <b>.env.example</b> în <b>.env</b> și completează URL + ANON KEY.</p><div className="code">VITE_SUPABASE_URL=https://proiectul-tau.supabase.co{`\n`}VITE_SUPABASE_ANON_KEY=cheia_ta_publica</div></AuthShell>
  }

  if (!session) {
    return (
      <AuthShell title={authMode === 'login' ? 'Intră în cont' : 'Creează cont'}>
        <form onSubmit={handleAuthSubmit} className="grid" style={{ gap: 12 }}>
          <div><label className="label">Email</label><input className="input" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} /></div>
          <div><label className="label">Parolă</label><input className="input" type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} /></div>
          <button className="btn primary">{authMode === 'login' ? 'Autentificare' : 'Creează cont'}</button>
          <button type="button" className="btn" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Nu ai cont? Creează unul' : 'Ai deja cont? Intră aici'}</button>
          {message ? <div className="notice">{message}</div> : null}
        </form>
      </AuthShell>
    )
  }

  if (pinState.enabled && !pinState.unlocked) {
    return (
      <AuthShell title="Acces securizat">
        <div className="grid" style={{ gap: 12 }}>
          <p className="subtitle">Introdu codul PIN pentru a deschide aplicația.</p>
          <input className="input" type="password" value={pinState.input} onChange={(e) => setPinState({ ...pinState, input: e.target.value })} />
          <button className="btn primary" onClick={() => setPinState((prev) => prev.input === prev.code ? { ...prev, unlocked: true, input: '' } : prev)}>Deschide</button>
        </div>
      </AuthShell>
    )
  }

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="badge">Nivel PRO • Supabase • PWA</div>
          <div className="title">{settings.appName}</div>
          <p className="subtitle">Aplicație completă de buget: cont real, salvare online, rapoarte, export și instalare pe telefon.</p>
        </div>
        <div className="toolbar">
          {installPrompt ? <button className="btn" onClick={installApp}>Instalează pe telefon</button> : null}
          <button className="btn" onClick={exportBackup}>Backup JSON</button>
          <button className="btn" onClick={exportTransactionsCsv}>CSV tranzacții</button>
          <button className="btn" onClick={handleLogout}>Ieșire</button>
        </div>
      </div>

      <div className="grid-5" style={{ marginTop: 18 }}>
        <MetricCard title="Venit total" value={formatMDL(totalIncome)} />
        <MetricCard title="Cheltuieli totale" value={formatMDL(totalExpense)} />
        <MetricCard title="Sold total" value={formatMDL(totalBalance)} />
        <MetricCard title="Luna curentă" value={formatMDL(currentMonthData.expense)} />
        <MetricCard title="Media lunară" value={formatMDL(avgExpense)} />
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card"><div className="inner"><div className="section-title">Obiectiv de economii</div><div style={{ fontSize: 32, fontWeight: 900 }}>{savingsProgress}%</div><p className="subtitle">Ai acumulat {formatMDL(Math.max(totalBalance, 0))} din {formatMDL(savingsGoal)}.</p><label className="label">Țintă economii</label><input className="input" type="number" value={savingsGoal} onChange={(e) => setSavingsGoal(Number(e.target.value || 0))} /><div className="progress" style={{ marginTop: 12 }}><div style={{ width: `${savingsProgress}%` }} /></div></div></div>
        <div className="card"><div className="inner"><div className="section-title">Status luna curentă</div><StatRow label="Venituri" value={formatMDL(currentMonthData.income)} /><StatRow label="Cheltuieli" value={formatMDL(currentMonthData.expense)} /><StatRow label="Sold" value={formatMDL(currentMonthData.balance)} /><StatRow label="Buget" value={formatMDL(currentMonthData.budget)} />{settings.overBudgetAlerts && currentMonthData.budget > 0 && currentMonthData.expense > currentMonthData.budget ? <div className="notice warning" style={{ marginTop: 12 }}>Ai depășit bugetul cu {formatMDL(currentMonthData.expense - currentMonthData.budget)}.</div> : null}</div></div>
      </div>

      <div style={{ marginTop: 18 }} className="tabs">
        {['dashboard','tranzactii','bugete','rapoarte','categorii','setari'].map((key) => <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{key[0].toUpperCase() + key.slice(1)}</button>)}
      </div>

      {tab === 'dashboard' ? <div className="grid" style={{ gap: 18, marginTop: 18 }}>
        <div className="grid-2">
          <div className="card"><div className="inner"><div className="section-title">Evoluție lunară</div><ChartBox><LineChart data={monthlyData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(v) => formatMDL(v)} /><Legend /><Line dataKey="income" name="Venituri" strokeWidth={3} /><Line dataKey="expense" name="Cheltuieli" strokeWidth={3} /><Line dataKey="budget" name="Buget" strokeWidth={2} /></LineChart></ChartBox></div></div>
          <div className="card"><div className="inner"><div className="section-title">Cheltuieli pe categorii</div><ChartBox><PieChart><Pie data={expenseCategoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={110}>{expenseCategoryData.map((entry, index) => <Cell key={entry.name} fill={`hsl(${index * 39} 72% 58%)`} />)}</Pie><Tooltip formatter={(v) => formatMDL(v)} /></PieChart></ChartBox></div></div>
        </div>
        <div className="grid-2">
          <div className="card"><div className="inner"><div className="section-title">Rezumat anual</div><ChartBox><BarChart data={annualData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip formatter={(v) => formatMDL(v)} /><Legend /><Bar dataKey="income" name="Venituri" /><Bar dataKey="expense" name="Cheltuieli" /></BarChart></ChartBox></div></div>
          <div className="card"><div className="inner"><div className="section-title">Insight-uri smart</div><div className="grid">{smartInsights.length ? smartInsights.map((text) => <div key={text} className="notice success">{text}</div>) : <div className="notice">Adaugă mai multe date pentru recomandări.</div>}</div></div></div>
        </div>
      </div> : null}

      {tab === 'tranzactii' ? <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card"><div className="inner"><div className="section-title">Adaugă / editează tranzacție</div><form onSubmit={saveTransaction} className="grid" style={{ gap: 12 }}>
          <div className="grid-2"><Field label="Tip"><select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: e.target.value === 'expense' ? categories.expenses[0] : categories.incomes[0] })}><option value="expense">Cheltuială</option><option value="income">Venit</option></select></Field><Field label="Data"><input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field></div>
          <Field label="Descriere"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid-2"><Field label="Categorie"><select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{(form.type === 'expense' ? categories.expenses : categories.incomes).map((c) => <option key={c}>{c}</option>)}</select></Field><Field label="Suma"><input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></div>
          <label className="mini-badge"><input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} /> Recurent</label>
          <div className="toolbar"><button className="btn primary">{editingId ? 'Salvează modificările' : 'Adaugă tranzacția'}</button>{editingId ? <button type="button" className="btn" onClick={() => { setEditingId(null); setForm(emptyForm) }}>Renunță</button> : null}</div>
        </form></div></div>
        <div className="card"><div className="inner"><div className="section-title">Filtrare și listă</div><div className="grid" style={{ gap: 10 }}><input className="input" placeholder="Caută..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /><div className="grid-2"><select className="select" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">Toate</option><option value="expense">Cheltuieli</option><option value="income">Venituri</option></select><select className="select" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}><option value="all">Toate lunile</option>{monthOptions.map((m) => <option key={m} value={m}>{getMonthLabel(m)}</option>)}</select></div><div className="table-list">{filteredTransactions.map((tx) => <div className="item-row" key={tx.id}><div><div style={{ fontWeight: 800 }}>{tx.description}</div><div className="muted small">{tx.category} • {tx.date}</div><div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className="mini-badge">{tx.type === 'income' ? 'venit' : 'cheltuială'}</span>{tx.recurring ? <span className="mini-badge">recurent</span> : null}</div></div><div className="item-actions"><strong>{formatMDL(tx.amount)}</strong><button className="btn soft" onClick={() => startEdit(tx)}>Editează</button><button className="btn soft" onClick={() => deleteTransaction(tx.id)}>Șterge</button></div></div>)}</div></div></div></div>
      </div> : null}

      {tab === 'bugete' ? <div className="card" style={{ marginTop: 18 }}><div className="inner"><div className="section-title">Bugete lunare</div><div className="grid-3">{monthlyData.map((m) => <div key={m.month} className="notice"><div style={{ fontWeight: 800 }}>{m.label}</div><div className="small muted">Cheltuit: {formatMDL(m.expense)}</div><div className="small muted">Venit: {formatMDL(m.income)}</div><label className="label" style={{ marginTop: 10 }}>Buget</label><input className="input" type="number" value={budgets[m.month] || ''} onChange={(e) => saveBudget(m.month, Number(e.target.value || 0))} /></div>)}</div></div></div> : null}

      {tab === 'rapoarte' ? <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card"><div className="inner"><div className="section-title">Export și print</div><div className="toolbar"><button className="btn" onClick={exportTransactionsCsv}>Export CSV tranzacții</button><button className="btn" onClick={exportMonthlyCsv}>Export CSV raport lunar</button><button className="btn primary" onClick={exportPrintableReport}>Print / PDF</button></div></div></div>
        <div className="card"><div className="inner"><div className="section-title">Rapoarte PRO</div><div className="notice">Ai la dispoziție CSV, PDF și backup JSON. Poți trimite ușor rapoarte contabilului sau păstra copii locale.</div></div></div>
      </div> : null}

      {tab === 'categorii' ? <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card"><div className="inner"><div className="section-title">Adaugă categorie</div><div className="grid" style={{ gap: 12 }}><select className="select" value={newCategoryType} onChange={(e) => setNewCategoryType(e.target.value)}><option value="expense">Cheltuială</option><option value="income">Venit</option></select><input className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Categorie nouă" /><button className="btn primary" onClick={addCategory}>Salvează</button></div></div></div>
        <div className="card"><div className="inner"><div className="section-title">Categorii existente</div><div className="grid"><div><div className="label">Cheltuieli</div><div className="pill-list">{categories.expenses.map((c) => <div className="pill" key={c}>{c}</div>)}</div></div><div><div className="label">Venituri</div><div className="pill-list">{categories.incomes.map((c) => <div className="pill" key={c}>{c}</div>)}</div></div></div></div></div>
      </div> : null}

      {tab === 'setari' ? <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card"><div className="inner"><div className="section-title">Setări aplicație</div><div className="grid" style={{ gap: 12 }}><Field label="Nume aplicație"><input className="input" value={settings.appName} onChange={(e) => setSettings({ ...settings, appName: e.target.value })} /></Field><label className="mini-badge"><input type="checkbox" checked={settings.proMode} onChange={(e) => setSettings({ ...settings, proMode: e.target.checked })} /> Mod PRO</label><label className="mini-badge"><input type="checkbox" checked={settings.overBudgetAlerts} onChange={(e) => setSettings({ ...settings, overBudgetAlerts: e.target.checked })} /> Alerte buget</label><label className="mini-badge"><input type="checkbox" checked={settings.smartInsights} onChange={(e) => setSettings({ ...settings, smartInsights: e.target.checked })} /> Insight-uri smart</label></div></div></div>
        <div className="card"><div className="inner"><div className="section-title">PIN local + deploy</div><div className="grid" style={{ gap: 12 }}><label className="mini-badge"><input type="checkbox" checked={pinState.enabled} onChange={(e) => setPinState({ ...pinState, enabled: e.target.checked, unlocked: !e.target.checked })} /> Activează PIN local</label><Field label="Cod PIN"><input className="input" type="password" value={pinState.code} onChange={(e) => setPinState({ ...pinState, code: e.target.value })} /></Field><button className="btn" onClick={() => setPinState({ ...pinState, unlocked: false, input: '' })}>Blochează aplicația</button><div className="notice">Pentru deploy: încarci proiectul pe GitHub, apoi îl imporți în Vercel și setezi variabilele VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY.</div></div></div></div>
      </div> : null}

      {message ? <div style={{ marginTop: 18 }} className="notice">{message}</div> : null}
    </div>
  )
}

function AuthShell({ title, children }) {
  return <div className="centered"><div className="card auth-card"><div className="inner"><div className="section-title">{title}</div>{children}</div></div></div>
}
function MetricCard({ title, value }) {
  return <div className="card kpi"><div className="inner"><div className="muted small">{title}</div><div className="kpi-value">{value}</div></div></div>
}
function StatRow({ label, value }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '10px 12px', borderRadius: 16, background: '#f8fafc' }}><span className="muted">{label}</span><strong>{value}</strong></div>
}
function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}
function ChartBox({ children }) {
  return <div style={{ width: '100%', height: 320 }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
}
