# Design System — SFV & SV+

> Cole este arquivo como `DESIGN.md` na raiz do projeto e adicione ao `CLAUDE.md`:
> **"Antes de gerar ou modificar qualquer UI, leia `DESIGN.md` e siga rigorosamente. Este documento é lei."**

---

## Filosofia

Somos um ERP/CRM para força de vendas de moda. O visual deve transmitir:

- **Precisão** — números são o produto. Tipografia tabular, alinhamentos milimétricos.
- **Calma** — o vendedor usa o dia inteiro. Nada de cores saturadas competindo por atenção.
- **Densidade útil** — informação por cm² alta, mas com respiro. Referência: Linear, Notion, Vercel, Height.
- **Nada de "cara de IA"** — sem gradientes roxos aleatórios, sem cards com barra colorida no topo, sem ícones em círculos pastel diferentes por card, sem emoji nos títulos.

Se ficou parecido com landing page de SaaS genérico de 2023, refaça.

---

## Regras invioláveis (o "não faça")

1. **Nunca** use cor hardcoded no componente (`bg-blue-500`, `text-white`, `#3B82F6`). Sempre token do design system.
2. **Nunca** use gradiente decorativo (`from-purple-500 to-pink-500`). Gradiente só em barra de progresso funcional ou hero de marca — nunca em card de KPI.
3. **Nunca** faça card de KPI com barra colorida no topo. Isso é assinatura de template Bootstrap 2018.
4. **Nunca** coloque ícone dentro de círculo pastel colorido no card. Ícone é monocromático, mesma cor do texto secundário.
5. **Nunca** use emoji como ícone de UI (🎯, 📊, 🏆). Use Lucide monocromático.
6. **Nunca** misture mais de 2 famílias de fonte. Uma sans para tudo, uma mono para número.
7. **Nunca** use `shadow-2xl`, `shadow-xl` em card de dashboard. Sombra de dashboard é `border` sutil ou `shadow-sm` no máximo.
8. **Nunca** arredonde além de `rounded-lg` (8px) em cards. `rounded-2xl` é para hero/marketing.
9. **Nunca** escreva "🎉 Sucesso!" ou copy exclamativo. Tom é seco e profissional: "Pedido criado.", "Meta atingida."
10. **Nunca** use mais de 1 cor de destaque por tela. Se tudo é destaque, nada é.

---

## Paleta

Baseada em neutros frios com **um único** acento âmbar (identidade Somma).
Todo token vive em `src/styles.css` como `oklch()`.

### Light (padrão)

```css
:root {
  /* Superfícies */
  --background:     oklch(0.99 0.002 250);   /* branco levemente frio */
  --surface:        oklch(0.975 0.003 250);  /* card em fundo branco */
  --surface-2:      oklch(0.955 0.004 250);  /* card em fundo card */
  --border:         oklch(0.91 0.005 250);   /* linha divisória */
  --border-strong:  oklch(0.85 0.006 250);   /* input, tabela */

  /* Texto */
  --foreground:     oklch(0.18 0.01 250);    /* título / número */
  --muted:          oklch(0.48 0.008 250);   /* label, secundário */
  --subtle:         oklch(0.62 0.006 250);   /* placeholder, hint */

  /* Acento único (Somma) */
  --accent:         oklch(0.72 0.16 55);     /* âmbar/laranja Somma */
  --accent-fg:      oklch(0.18 0.02 55);

  /* Semânticos (use com moderação) */
  --success:        oklch(0.62 0.13 155);
  --warning:        oklch(0.75 0.14 75);
  --danger:         oklch(0.58 0.20 27);
  --info:           oklch(0.58 0.12 240);
}
```

### Dark

```css
.dark {
  --background:     oklch(0.15 0.008 250);
  --surface:        oklch(0.19 0.008 250);
  --surface-2:      oklch(0.22 0.008 250);
  --border:         oklch(0.28 0.01 250);
  --border-strong:  oklch(0.35 0.01 250);

  --foreground:     oklch(0.97 0.003 250);
  --muted:          oklch(0.68 0.01 250);
  --subtle:         oklch(0.55 0.008 250);

  --accent:         oklch(0.76 0.17 55);
  --accent-fg:      oklch(0.15 0.01 55);

  --success:        oklch(0.70 0.14 155);
  --warning:        oklch(0.80 0.15 75);
  --danger:         oklch(0.68 0.20 27);
  --info:           oklch(0.70 0.13 240);
}
```

**Regra de uso das cores semânticas:** apenas em badges de status, ícones de alerta e barras de progresso funcional. **Nunca** em fundo de card decorativo.

---

## Tipografia

- **Sans:** `Inter` (variable). Fallback: `-apple-system, system-ui`.
- **Números / mono:** `JetBrains Mono` variable, `font-variant-numeric: tabular-nums`.

**Regra:** todo número que representa dinheiro, quantidade, porcentagem ou data usa `tabular-nums`. Sempre.

### Escala (não invente tamanhos fora dela)
| Uso                        | Tamanho / peso              |
|----------------------------|-----------------------------|
| KPI grande (hero número)   | `text-3xl font-semibold`    |
| Título de seção            | `text-lg font-semibold`     |
| Título de card             | `text-sm font-medium`       |
| Label de KPI               | `text-xs font-medium uppercase tracking-wide text-muted` |
| Corpo                      | `text-sm`                   |
| Meta / hint                | `text-xs text-muted`        |

**Nunca use `font-bold` em número.** Use `font-semibold`. `font-bold` em números grandes fica pesado e cara-de-IA.

---

## Espaçamento e raio

- Grid base: **4px**. Só use múltiplos: `gap-2, gap-3, gap-4, gap-6, gap-8`.
- Padding padrão de card: `p-5` (20px).
- Raio: `rounded-md` (6px) para inputs/botões, `rounded-lg` (8px) para cards. Nada além disso.
- Divisórias sempre `border-border`, nunca `border-gray-200`.

---

## Componentes-chave (como devem ser)

### KPI Card (substitui os cards atuais do SFV)

```tsx
<div className="rounded-lg border border-border bg-surface p-5 transition-colors hover:bg-surface-2">
  <div className="flex items-center justify-between">
    <span className="text-xs font-medium uppercase tracking-wide text-muted">
      Total de pedidos
    </span>
    <ShoppingCart className="h-4 w-4 text-muted" strokeWidth={1.5} />
  </div>
  <div className="mt-3 flex items-baseline gap-2">
    <span className="text-3xl font-semibold tabular-nums text-foreground">199</span>
    <span className="text-xs font-medium text-success tabular-nums">+12%</span>
  </div>
  <div className="mt-1 text-xs text-subtle">vs. 30 dias anteriores</div>
</div>
```

**O que mudou em relação ao print atual:**
- Sem barra colorida no topo.
- Sem ícone em círculo pastel — ícone monocromático no canto.
- Label em uppercase pequeno em vez de bold.
- Número em `font-semibold`, não `font-black`.
- Adiciona delta (variação) — informação útil que quase todo dashboard bom tem.

### Card de Meta / Progresso (substitui o "OUZZARE VERÃO 2027")

```tsx
<div className="rounded-lg border border-border bg-surface p-6">
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">Ouzzare</div>
      <h3 className="mt-1 truncate text-lg font-semibold">Ouzzare Verão 2027</h3>
    </div>
    <div className="flex gap-1">
      <IconButton icon={Plus} label="Vendedor" />
      <IconButton icon={Pencil} label="Editar" />
      <IconButton icon={Trash2} label="Remover" />
    </div>
  </div>

  <div className="mt-6 flex items-baseline justify-between gap-4">
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-semibold tabular-nums">18.492</span>
      <span className="text-sm text-muted tabular-nums">/ 50.000 pç</span>
    </div>
    <span className="text-sm font-medium tabular-nums text-accent">37,0%</span>
  </div>

  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
    <div className="h-full rounded-full bg-accent" style={{ width: "37%" }} />
  </div>
  <div className="mt-2 text-xs text-subtle tabular-nums">Faltam 31.508 pç</div>
</div>
```

**O que mudou:** fundo branco (não roxo com gradiente), barra fina (não pesadona), acento único âmbar (não rosa/vermelho), sem emoji no título.

### Navegação (top nav do SFV)
- Fundo: `bg-background` com `border-b border-border`. **Sem azul chapado.**
- Logo à esquerda, links em `text-sm text-muted`, ativo em `text-foreground` com underline animada.
- CTA "Novo Pedido" único, em `bg-foreground text-background` (não âmbar — reserve âmbar para dados).
- Avatar do usuário à direita, sem badge "Administrador" competindo com o nome. Badge vai em dropdown.

### Tabela (regras)
- Zebra: **não use**. Use apenas `border-b border-border` entre linhas.
- Header: `text-xs uppercase tracking-wide text-muted font-medium`.
- Números sempre alinhados à direita e `tabular-nums`.
- Ações da linha aparecem só no hover: `opacity-0 group-hover:opacity-100`.

### Botões (variantes)
| Variante   | Uso                                | Estilo                              |
|------------|------------------------------------|-------------------------------------|
| `primary`  | Ação principal única por tela      | `bg-foreground text-background`     |
| `secondary`| Ação secundária                    | `border border-border bg-surface`   |
| `ghost`    | Ícone, ação leve                   | `hover:bg-surface-2`                |
| `danger`   | Excluir                            | `text-danger hover:bg-danger/10`    |

**Nunca** dois botões primários lado a lado. Se tiver dois, um vira `secondary`.

### Ícones
- Biblioteca: **Lucide React** apenas.
- Tamanho padrão: `h-4 w-4`. Em KPI/hero pode ir a `h-5 w-5`.
- `strokeWidth={1.5}` sempre (o padrão 2 fica pesado).
- Cor: `text-muted` em contexto neutro, `text-foreground` em ativo. **Nunca** colorido decorativo.

---

## Layout de Dashboard (SFV especificamente)

**Antes (o que tem):** navbar azul chapado + hero preto + 12 KPIs iguais em grid.

**Depois:**
1. Nav clean com border-bottom (não bloco de cor).
2. Header da página: título grande + filtros de período à direita (segmented control), sem hero preto.
3. **Hierarquia de KPIs:** 3-4 KPIs "hero" grandes na primeira linha (Total Vendas, Pedidos, Ticket Médio, Vendido Hoje). Depois seção "Comissões" com 3 cards menores. Depois "Operação" (Peças, Clientes) com 2-3 cards menores.
4. Metas por marca abaixo, cada uma em card branco simples com barra âmbar.

**Grid:** `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`. Não force 12 colunas iguais — importância dita tamanho.

---

## Copy / Microtexto

- **Português seco.** "Pedido criado." não "🎉 Pedido criado com sucesso!"
- **Sem exclamação** em UI normal. Reserve para erro grave.
- **Números primeiro, contexto depois:** "R$ 1.914.006,63 em vendas" não "As vendas totais foram de R$..."
- Datas: `dd 'de' MMM` (português), nunca `MM/DD/YYYY`.
- Moeda: `R$ 1.914.006,63` (ponto milhar, vírgula decimal). Use `Intl.NumberFormat('pt-BR')`.

---

## Animação

- Só transições de **cor** e **opacity** em hover. Duração `150ms`.
- **Nunca** anime `y` em entrada de card ("fade up staggered"). É a maior assinatura de IA em 2025.
- Loading: skeleton cinza estático (`bg-surface-2 animate-pulse`), não spinner colorido.

---

## Checklist antes de commitar UI

- [ ] Zero classes de cor hardcoded (`bg-blue-*`, `text-white`, `#hex`)
- [ ] Nenhum emoji em título/label
- [ ] Nenhum gradiente decorativo (só barra de progresso)
- [ ] Nenhum ícone dentro de círculo pastel
- [ ] Todos os números têm `tabular-nums`
- [ ] No máximo 1 botão primário por tela
- [ ] Cards com `border`, não `shadow-xl`
- [ ] Copy no imperativo seco
- [ ] Testado em light e dark

Se qualquer item falhar, o componente **não** vai pra branch.
