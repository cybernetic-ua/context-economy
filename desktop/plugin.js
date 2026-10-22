/**
 * Context Economy — side page + compact pane.
 *
 * Backend: dashboard/plugin_api.py → GET /api/plugins/context-economy/stats?range=7d
 *
 * STYLING NOTE: this file loads at runtime, so Tailwind never sees its class
 * names — arbitrary utilities like `grid-cols-[…]` are NOT generated and
 * silently do nothing. Structure therefore uses inline styles + the app's CSS
 * variables (--ui-text-*, --ui-stroke-*, --ui-accent).
 *
 * Copy is English-first: every string lives in MESSAGES, `en` is the source of
 * truth, other locales are bundles registered through ctx.i18n.
 */
import { ROUTES_AREA, SIDEBAR_NAV_AREA, usePluginI18n, useQuery } from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'context-economy'
const ROUTE = '/context-economy'
const RANGES = ['24h', '7d', '30d']
const REFRESH_KEY = 'refreshSec'
const REFRESH_PRESETS = [
  { seconds: 3, label: '3s' },
  { seconds: 30, label: '30s' },
  { seconds: 180, label: '3m' }
]
const MIN_W = 240

const MESSAGES = {
  en: {
    'Context economy': 'Context economy',
    'Context economy subtitle': 'Where the context actually goes, what it costs, and how much of it never reaches the prompt.',
    'Status updated': (time) => 'updated ' + time,
    'Status updating': 'updating…',
    'Refresh interval': 'Refresh interval',
    'Period': 'Period',
    'Input tokens': 'Input tokens',
    'Input tokens detail': (calls, sessions) => calls + ' API · ' + sessions + ' sessions',
    'Cloud estimate': 'Cloud (est.)',
    'Cache saved': (amount) => 'cache saved ' + amount,
    'All requests local': 'all requests local — $0',
    'Top consumer': 'Top consumer',
    'Top consumer detail': (bytes, pct) => bytes + ' · ' + pct + ' of payload',
    'Folded messages': 'Folded',
    'Folded last session': (n) => 'last session: ' + n,
    'No data': 'no data',
    'What eats the context': 'What eats the context',
    'No tool calls': 'No tool calls in this period',
    'Prompt cache': 'Prompt cache',
    'Cloud tokens': 'Cloud tokens',
    'Saved on cache': 'saved on cache',
    'Local tokens': 'Local tokens',
    'Untariffed speed only': 'untariffed, speed only',
    'Prompt share from cache': (pct) => pct + ' of the prompt came from cache',
    'Folded per day': 'Folded per day',
    'Context sandbox': 'ctx_* sandbox',
    'Sandbox calls': 'calls',
    'Sandbox returned': 'returned',
    'Sandbox outside context': 'outside context',
    'Sandbox unused': 'ctx_* was not called in this period — reads went direct',
    'Started': 'Started',
    'Model': 'Model',
    'Input': 'Input',
    'Returned': 'Returned',
    'Folded': 'Folded',
    'No sessions': 'No sessions in this period',
    'Sessions shown': (shown, total) => shown + ' of ' + total + ' sessions',
    'Scroll the list': 'scroll the list',
    'All sessions': 'all sessions',
    'Folded note': 'Folded — messages the compressor replaced with a summary: they no longer take context.',
    'Where the prices come from': 'Where the prices come from',
    'Prices source': 'Prices come from the local models.dev snapshot maintained by Hermes (models_dev_cache.json). No network involved.',
    'Cost model': 'Cost = tokens × model price. It is an estimate, not a provider invoice: an actual price appears only when the provider returns one.',
    'Cache savings formula': 'Cache savings (cloud only) = cached tokens / 1M × (input price − cache price). Local models are not billed, so they show $0: there caching buys speed, not money.',
    'Unknown cache price': 'When a model has no published cache price the amount is never invented — its tokens are shown without money.',
    'Backend unavailable': 'The backend is not responding.'
  },
  uk: {
    'Context economy': 'Економія контексту',
    'Context economy subtitle': 'Де саме йде контекст, скільки це коштує і скільки вдалося вивести з промпту.',
    'Status updated': (time) => 'оновлено ' + time,
    'Status updating': 'оновлення…',
    'Refresh interval': 'Інтервал оновлення',
    'Period': 'Період',
    'Input tokens': 'Вхідні токени',
    'Input tokens detail': (calls, sessions) => calls + ' API · ' + sessions + ' сесій',
    'Cloud estimate': 'Хмара (оцінка)',
    'Cache saved': (amount) => 'кеш зекономив ' + amount,
    'All requests local': 'усі запити локальні — $0',
    'Top consumer': 'Головний споживач',
    'Top consumer detail': (bytes, pct) => bytes + ' · ' + pct + ' обсягу',
    'Folded messages': 'Згорнуто',
    'Folded last session': (n) => 'остання сесія: ' + n,
    'No data': 'немає даних',
    'What eats the context': 'Хто їсть контекст',
    'No tool calls': 'За цей період немає tool-викликів',
    'Prompt cache': 'Кеш промпту',
    'Cloud tokens': 'Хмарні токени',
    'Saved on cache': 'зекономлено на кеші',
    'Local tokens': 'Локальні токени',
    'Untariffed speed only': 'не тарифікується, лише швидкість',
    'Prompt share from cache': (pct) => pct + ' промпту з кешу',
    'Folded per day': 'Згорнуто по днях',
    'Context sandbox': 'Пісочниця ctx_*',
    'Sandbox calls': 'викликів',
    'Sandbox returned': 'повернуто',
    'Sandbox outside context': 'поза контекстом',
    'Sandbox unused': 'ctx_* не викликались у цьому періоді — усе читалося напряму',
    'Started': 'Початок',
    'Model': 'Модель',
    'Input': 'Вхід',
    'Returned': 'Повернено',
    'Folded': 'Згорнуто',
    'No sessions': 'Немає сесій за цей період',
    'Sessions shown': (shown, total) => shown + ' із ' + total + ' сесій',
    'Scroll the list': 'прокрути список',
    'All sessions': 'усі сесії',
    'Folded note': 'Згорнуто — повідомлень, які компресор замінив стислим підсумком: вони більше не займають контекст.',
    'Where the prices come from': 'Звідки беруться ціни',
    'Prices source': 'Ціни — з локального знімка прайс-листа models.dev, який веде сам Hermes (models_dev_cache.json). Мережа не потрібна.',
    'Cost model': 'Витрати = токени × ціна моделі. Це оцінка Hermes, а не рахунок провайдера: фактична ціна є лише тоді, коли провайдер її повертає.',
    'Cache savings formula': 'Економія кешу (лише хмара) = cache-токени / 1M × (ціна входу − ціна кешу). Локальні моделі не тарифікуються, тому там $0: кеш дає швидкість, а не гроші.',
    'Unknown cache price': 'Якщо для моделі немає ціни кешу, сума не вигадується — токени показуються без грошей.',
    'Backend unavailable': 'Бекенд не відповідає.'
  }
}

let ctxRest = () => Promise.reject(new Error('plugin not initialised'))
let pluginCtx = null
let initialRefresh = 30

/* ---------- style kit (inline, var-driven) ---------- */

const C = {
  text: 'var(--ui-text-primary)',
  body: 'var(--ui-text-secondary)',
  soft: 'var(--ui-text-tertiary)',
  faint: 'var(--ui-text-quaternary)',
  stroke: 'var(--ui-stroke-secondary)',
  accent: 'var(--ui-accent)'
}

const S = {
  card: { border: '1px solid ' + C.stroke, borderRadius: 8 },
  label: {
    fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: C.soft, lineHeight: 1.3
  },
  body: { fontSize: 13, lineHeight: 1.5, color: C.body },
  hint: { fontSize: 12, lineHeight: 1.4, color: C.soft },
  num: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' },
  value: { fontSize: 21, fontWeight: 600, lineHeight: 1.15 },
  kpiPad: { padding: '14px 16px' },
  secPad: { padding: '14px 16px' },
  th: { padding: '8px 14px', borderBottom: '1px solid ' + C.stroke },
  td: { padding: '8px 14px', fontSize: 12.5, color: C.body, lineHeight: 1.4 },
  btn: {
    fontSize: 11.5, padding: '5px 10px', borderRadius: 6, border: '1px solid transparent',
    background: 'transparent', cursor: 'pointer', color: C.faint, lineHeight: 1.2
  },
  btnOn: { borderColor: C.accent, color: C.accent }
}

const fmtBytes = n => {
  if (n === null || n === undefined) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MB'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB'
  return Math.round(n) + ' B'
}
const fmtNum = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString())
const fmtMoney = v => (v > 0 ? '$' + Number(v).toFixed(2) : '$0')
const fmtPct = v => (v === null || v === undefined ? '—' : v.toFixed(1) + '%')
// Table cells are narrow; a 7-digit token count does not fit at 12.5px mono.
const fmtCompact = n => {
  const v = Number(n) || 0
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'K'
  return Number.isFinite(v) ? String(Math.round(v)) : '—'
}
const shortModel = m => String(m || '?').split('/').pop()

function Label({ children, style }) {
  return jsx('div', { style: { ...S.label, ...style }, children })
}

function Stat({ labelText, value, hint, accent }) {
  return jsxs('div', { style: { ...S.card, ...S.kpiPad }, children: [
    jsx(Label, { children: labelText }),
    jsx('div', {
      style: { ...S.num, ...S.value, marginTop: 6, color: accent ? C.accent : C.text },
      children: value
    }),
    jsx('div', { style: { ...S.hint, marginTop: 4 }, children: hint })
  ]})
}

function Segmented({ items, value, onChange, ariaLabel }) {
  return jsx('div', {
    role: 'group', 'aria-label': ariaLabel,
    style: { display: 'flex', gap: 2, padding: 2, borderRadius: 8, border: '1px solid ' + C.stroke },
    children: items.map(it => {
      const on = it.value === value
      return jsx('button', {
        type: 'button',
        onClick: () => onChange(it.value),
        'aria-pressed': on,
        style: {
          ...S.num, ...S.btn, minWidth: it.minWidth || 34, textAlign: 'center',
          ...(on ? S.btnOn : null)
        },
        children: it.label
      }, it.key)
    })
  })
}

function Bar({ name, bytes, pct, accent }) {
  return jsxs('div', {
    style: {
      display: 'grid', gridTemplateColumns: '84px minmax(40px,1fr) 68px',
      alignItems: 'center', gap: 10, padding: '7px 0'
    },
    children: [
      jsx('div', {
        style: { ...S.num, fontSize: 12, color: C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        title: name,
        children: name
      }),
      jsxs('div', {
        style: { position: 'relative', height: 6, borderRadius: 3, background: 'transparent', overflow: 'hidden' },
        children: [
          jsx('div', {
            style: {
              position: 'absolute', inset: 0, borderRadius: 3,
              background: C.stroke, opacity: 0.35
            }
          }),
          jsx('div', {
            style: {
              position: 'relative', height: '100%', borderRadius: 3,
              width: Math.max(2, Math.min(100, pct)) + '%',
              background: accent ? C.accent : C.faint
            }
          })
        ]
      }),
      jsxs('div', {
        style: {
          ...S.num, fontSize: 11, textAlign: 'right', lineHeight: 1.35,
          whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end'
        },
        children: [
          jsx('div', { style: { color: C.soft }, children: fmtBytes(bytes) }),
          jsx('div', { style: { color: C.soft }, children: fmtPct(pct) })
        ]
      })
    ]
  })
}

function Spark({ days }) {
  if (!days || !days.length) return null
  const max = Math.max(...days.map(d => d.folded), 1)
  return jsx('div', {
    style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 52 },
    children: days.slice(-14).map((d, i) =>
      jsx('div', {
        title: d.date + ' · ' + d.folded,
        style: { flex: 1, display: 'flex', alignItems: 'flex-end' },
        children: jsx('div', {
          style: {
            width: '100%', borderRadius: 2, background: C.faint, opacity: 0.75,
            height: Math.max(2, Math.round((d.folded / max) * 48))
          }
        })
      }, i)
    )
  })
}

const COLS = '96px minmax(0,1fr) 54px 74px 58px'

function Rows({ head, rows, empty, maxHeight, resetKey }) {
  return jsxs('div', { style: { ...S.card, overflow: 'hidden' }, children: [
    jsx('div', {
      style: { display: 'grid', gridTemplateColumns: COLS, gap: 10, ...S.th, alignItems: 'center' },
      children: head.map((h, i) =>
        jsx('div', { style: { ...S.label, textAlign: i >= 2 ? 'right' : 'left' }, children: h }, i)
      )
    }),
    jsx('div', {
      key: resetKey || 'rows',
      style: {
        maxHeight: maxHeight || 340, overflowY: 'auto',
        // Scroll anchoring would keep the old position when the poll rebuilds
        // rows, leaving the first row sliced in half.
        overflowAnchor: 'none'
      },
      children: rows.length
        ? rows.map((cells, ri) =>
            jsxs('div', {
              style: {
                display: 'grid', gridTemplateColumns: COLS, gap: 10, ...S.td,
                alignItems: 'center', borderTop: ri ? '1px solid ' + C.stroke : 'none'
              },
              children: cells.map((c, i) =>
                jsx('div', {
                  style: {
                    ...S.num, textAlign: i >= 2 ? 'right' : 'left', color: C.body,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  },
                  title: c && typeof c === 'object' ? c.title : (typeof c === 'string' ? c : undefined),
                  children: c && typeof c === 'object' ? c.v : c
                }, i)
              )
            }, ri)
          )
        : jsx('div', { style: { ...S.body, padding: '18px 16px', color: C.faint }, children: empty })
    })
  ]})
}

function PriceNote({ t }) {
  const [open, setOpen] = useState(false)
  return jsxs('div', { style: S.card, children: [
    jsx('button', {
      type: 'button',
      onClick: () => setOpen(!open),
      'aria-expanded': open,
      style: {
        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, color: C.soft, textAlign: 'left'
      },
      children: [
        jsx('span', { children: t('Where the prices come from') }),
        jsx('span', { style: { ...S.num, fontSize: 13 }, children: open ? '−' : '+' })
      ]
    }),
    open
      ? jsx('div', {
          style: {
            borderTop: '1px solid ' + C.stroke, padding: '12px 16px',
            fontSize: 12.5, lineHeight: 1.55, color: C.soft
          },
          children: ['price.source', 'price.cost', 'price.cache', 'price.missing'].map((key, i) =>
            jsx('p', { style: { margin: i === 3 ? 0 : '0 0 8px' }, children: t(key) }, key)
          )
        })
      : null
  ]})
}

function Body({ dense, t }) {
  const [range, setRange] = useState('7d')
  const [refreshSec, setRefreshSec] = useState(initialRefresh)

  const { data, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['context-economy', range],
    queryFn: () => ctxRest('/stats?range=' + encodeURIComponent(range)),
    refetchInterval: refreshSec * 1000,
    refetchIntervalInBackground: true,
    placeholderData: prev => prev,
    retry: false,
    staleTime: Math.max(1000, refreshSec * 500)
  })

  const pickRefresh = sec => {
    setRefreshSec(sec)
    try { pluginCtx && pluginCtx.storage && pluginCtx.storage.set(REFRESH_KEY, sec) } catch (e) {}
  }

  if (error && !data) {
    return jsxs('div', { style: { ...S.card, padding: 16, fontSize: 13 }, children: [
      jsx('div', { style: { color: C.body }, children: t('Backend unavailable') }),
      jsx('div', { style: { ...S.hint, marginTop: 4 }, children: String(error.message || error) })
    ]})
  }

  const h = (data && data.hermes) || {}
  const tot = h.totals || {}
  const cs = tot.cost_split || {}
  const cache = tot.cache || {}
  const tools = h.tools || []
  const sessions = h.sessions || []
  const days = h.daily || []
  const sb = (data && data.sandbox) || {}
  const top = tools[0]
  const foldedTotal = days.reduce((a, d) => a + d.folded, 0)
  const stamp = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour12: false })
    : '—'

  const header = jsxs('div', {
    style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    children: [
      jsx('div', {
        'aria-live': 'polite',
        style: {
          fontSize: 11.5, color: C.faint, ...S.num,
          // Reserved width: "updating…" is shorter than "updated 21:04:05", so
          // without this the control cluster jumps left/right on every poll.
          minWidth: dense ? 96 : 116, flex: '0 0 auto',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        },
        // Keep the timestamp stable and signal the poll with a dot: swapping the
        // text on every refetch made a 3 s interval read as a permanent "updating…".
        children: jsxs('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 }, children: [
          jsx('span', {
            style: {
              width: 5, height: 5, borderRadius: 3, flex: '0 0 auto',
              background: isFetching ? C.accent : 'transparent',
              transition: 'background 120ms linear'
            }
          }),
          jsx('span', { children: t('Status updated', stamp) })
        ]})
      }),
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flex: '0 0 auto' },
        children: [
          jsx(Segmented, {
            items: REFRESH_PRESETS.map(p => ({ key: String(p.seconds), label: p.label, value: p.seconds, minWidth: 38 })),
            value: refreshSec, onChange: pickRefresh, ariaLabel: t('Refresh interval')
          }),
          jsx(Segmented, {
            items: RANGES.map(r => ({ key: r, label: r, value: r, minWidth: 44 })),
            value: range, onChange: setRange, ariaLabel: t('Period')
          })
        ]
      })
    ]
  })

  const kpis = jsx('div', {
    style: {
      display: 'grid', gap: 10,
      gridTemplateColumns: dense ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fit, minmax(200px, 1fr))'
    },
    children: [
      jsx(Stat, {
        labelText: t('Input tokens'),
        value: fmtNum(tot.input),
        hint: t('Input tokens detail', fmtNum(tot.api_calls), fmtNum(tot.sessions))
      }),
      jsx(Stat, {
        labelText: t('Cloud estimate'),
        value: fmtMoney(cs.cloud_cost),
        hint: cache.cloud_saved_usd > 0 ? t('Cache saved', fmtMoney(cache.cloud_saved_usd)) : t('All requests local')
      }),
      jsx(Stat, {
        labelText: t('Top consumer'),
        value: top ? top.tool : '—',
        hint: top ? t('Top consumer detail', fmtBytes(top.bytes), fmtPct(top.pct)) : t('No data'),
        accent: true
      }),
      jsx(Stat, {
        labelText: t('Folded messages'),
        value: fmtNum(foldedTotal),
        hint: sessions[0] ? t('Folded last session', fmtNum(sessions[0].folded)) : t('No data')
      })
    ]
  })

  const toolBlock = jsxs('section', { style: { ...S.card, ...S.secPad }, children: [
    jsx(Label, { children: t('What eats the context') }),
    jsx('div', { style: { marginTop: 4 }, children: tools.slice(0, dense ? 4 : 8).map((x, i) =>
      jsx(Bar, { name: x.tool, bytes: x.bytes, pct: x.pct, accent: i === 0 }, x.tool)) }),
    !tools.length ? jsx('div', { style: { ...S.body, color: C.faint, padding: '10px 0' }, children: t('No tool calls') }) : null
  ]})

  const cacheBlock = jsxs('section', { style: { ...S.card, ...S.secPad }, children: [
    jsx(Label, { children: t('Prompt cache') }),
    jsxs('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }, children: [
      jsxs('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }, children: [
        jsxs('div', { children: [
          jsx('div', { style: S.body, children: t('Cloud tokens') }),
          jsx('div', { style: S.hint, children: t('Saved on cache') })
        ]}),
        jsxs('div', {
          style: {
            ...S.num, fontSize: 12, textAlign: 'right', lineHeight: 1.35,
            whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end'
          },
          children: [
            jsx('div', { style: { color: C.body }, children: fmtNum(cache.cloud_tokens) }),
            jsx('div', { style: { fontSize: 11, color: C.soft }, children: fmtMoney(cache.cloud_saved_usd) })
          ]
        })
      ]}),
      jsxs('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }, children: [
        jsxs('div', { children: [
          jsx('div', { style: S.body, children: t('Local tokens') }),
          jsx('div', { style: S.hint, children: t('Untariffed speed only') })
        ]}),
        jsxs('div', {
          style: {
            ...S.num, fontSize: 12, textAlign: 'right', lineHeight: 1.35,
            whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end'
          },
          children: [
            jsx('div', { style: { color: C.soft }, children: fmtNum(cache.local_tokens) }),
            jsx('div', { style: { fontSize: 11.5, color: C.soft }, children: '$0' })
          ]
        })
      ]})
    ]}),
    jsx('div', { style: { ...S.hint, marginTop: 8 }, children: t('Prompt share from cache', fmtPct(tot.cache_pct)) })
  ]})

  const foldBlock = jsxs('section', { style: { ...S.card, ...S.secPad }, children: [
    jsx(Label, { children: t('Folded per day') }),
    jsx('div', { style: { marginTop: 10 }, children: jsx(Spark, { days }) }),
    jsxs('div', {
      style: { display: 'flex', justifyContent: 'space-between', marginTop: 4, ...S.hint },
      children: [
        jsx('span', { children: days.length ? days[0].date.slice(5) : '' }),
        jsx('span', { children: days.length ? days[days.length - 1].date.slice(5) : '' })
      ]
    })
  ]})

  const sandboxBlock = jsxs('section', { style: { ...S.card, ...S.secPad }, children: [
    jsx(Label, { children: t('Context sandbox') }),
    jsxs('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginTop: 8 }, children: [
      jsxs('div', { children: [
        jsx('div', { style: { ...S.num, fontSize: 17, color: C.text }, children: fmtNum(sb.calls) }),
        jsx(Label, { children: t('Sandbox calls') })
      ]}),
      jsxs('div', { children: [
        jsx('div', { style: { ...S.num, fontSize: 17, color: C.text }, children: fmtBytes(sb.returned) }),
        jsx(Label, { children: t('Sandbox returned') })
      ]}),
      jsxs('div', { children: [
        jsx('div', { style: { ...S.num, fontSize: 17, color: C.text }, children: fmtBytes((sb.kept_out || 0) + (sb.indexed || 0)) }),
        jsx(Label, { children: t('Sandbox outside context') })
      ]})
    ]}),
    !sb.calls ? jsx('div', { style: { ...S.hint, marginTop: 8 }, children: t('Sandbox unused') }) : null
  ]})

  const shown = sessions
  const sessionBlock = jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
    jsx(Rows, {
      head: [t('Started'), t('Model'), t('Input'), t('Returned'), t('Folded')],
      rows: shown.map(s => [
        s.started,
        { v: shortModel(s.model), title: s.model },
        { v: fmtCompact(s.input), title: fmtNum(s.input) + ' input tokens' },
        { v: fmtCompact(s.output), title: fmtNum(s.output) + ' output tokens' },
        { v: fmtCompact(s.folded), title: fmtNum(s.folded) + ' folded messages' }
      ]),
      empty: t('No sessions'),
      maxHeight: dense ? 190 : 320,
      resetKey: range + ':' + shown.length + ':' + (shown[0] ? shown[0].id : '')
    }),
    jsx('div', { style: { ...S.hint, display: 'flex', justifyContent: 'space-between' }, children: [
      jsx('span', {
        children: shown.length < (tot.sessions || 0)
          ? t('Sessions shown', shown.length, fmtNum(tot.sessions))
          : fmtNum(shown.length) + ' sessions'
      }),
      jsx('span', { children: shown.length < (tot.sessions || 0) ? t('Scroll the list') : t('All sessions') })
    ]})
  ]})

  return jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: [
    header,
    h.error ? jsx('div', { style: { ...S.hint }, children: h.error }) : null,
    kpis,
    toolBlock,
    cacheBlock,
    dense
      ? sandboxBlock
      : jsx('div', { style: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }, children: [foldBlock, sandboxBlock] }),
    sessionBlock,
    jsx('div', { style: { ...S.hint, marginTop: -4 }, children: t('Folded note') }),
    dense ? null : jsx(PriceNote, { t })
  ]})
}

function Page({ t }) {
  return jsxs('div', {
    style: { maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 24 },
    children: [
      jsxs('header', { children: [
        jsx('h1', { style: { fontSize: 18, fontWeight: 600, margin: 0 }, children: t('Context economy') }),
        jsx('p', { style: { ...S.body, margin: '4px 0 0', color: C.soft }, children: t('Context economy subtitle') })
      ]}),
      jsx(Body, { dense: false, t })
    ]
  })
}

function Pane({ t }) {
  return jsx('div', {
    style: { height: '100%', overflow: 'auto', padding: '12px 14px' },
    children: jsx(Body, { dense: true, t })
  })
}

function Shell({ dense }) {
  const t = usePluginI18n(ID)
  return dense ? jsx(Pane, { t }) : jsx(Page, { t })
}

export default {
  id: ID,
  name: 'Context Economy',
  register(ctx) {
    pluginCtx = ctx
    if (typeof ctx.rest === 'function') ctxRest = ctx.rest
    try { ctx.i18n.register(MESSAGES) } catch (e) {}
    try { initialRefresh = Number(ctx.storage && ctx.storage.get(REFRESH_KEY)) || 30 } catch (e) { initialRefresh = 30 }
    if (!REFRESH_PRESETS.some(p => p.seconds === initialRefresh)) initialRefresh = 30

    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(Shell, { dense: false }) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Context', codicon: 'graph' } },
      {
        id: 'pane', area: 'panes', title: 'context',
        data: { placement: 'right', minWidth: MIN_W + 'px' },
        render: () => jsx(Shell, { dense: true })
      }
    ])
  }
}
