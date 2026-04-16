# Runebond APY Dashboard — Lessons Learned

## ✅ Stan projektu (2026-04-16)

Dashboard **gotowy** (`index.html`). Wyświetla **real LP Effective APY** = bonding yield + fee income z prawdziwych danych 30d.

### Zweryfikowane wartości (live, 2026-04-16):
| Metric | Value | Źródło |
|--------|-------|--------|
| LP Effective APY | 16.95% | bonding + fee |
| Bonding Yield | 5.01% (na total capital) | `network.bondingAPY` z Midgard |
| 5% Fee Income | 11.94% (175.80 ᚱ / 30d) | outgoing `send` payouts z LP |
| 30d Redemption Volume | 3,515.90 ᚱ gross (41 payouts) | inferowane z net payouts 30d |
| Net Payouts 30d | 3,340.11 ᚱ | real outgoing `send` z LP |
| Network Bonding APY | 10.87% | `midgard/v2/network` |
| Total Capital | 17,910 ᚱ | bonded + liquid |

### Najważniejsze wnioski po korekcie modelu:
- ❌ Poprzednie założenie było błędne: `rebond` **nie jest** wiarygodnym źródłem `redemption volume` dla Runebond w obecnym flow.
- ✅ W praktyce user exits są widoczne jako **outgoing `send`** z LP do użytkowników.
- ✅ Fee LP liczymy z payoutów netto:

```text
netPayouts30d        = suma outgoing send z LP do userów
grossRedemption30d   = netPayouts30d / 0.95
feeIncome30d         = grossRedemption30d - netPayouts30d
feeYieldOnTotal      = (feeIncome30d * 365/30) / totalCapital
```

- ✅ `Network Bonding APY` bierzemy bezpośrednio z `midgard/v2/network` jako `bondingAPY`.
- ❌ Nie rekonstruujemy już APY wyłącznie z `history/earnings`, bo mieszanie 30d earnings z bieżącym `totalActiveBond` może zawyżać wynik.

---

## 📐 Model biznesowy LP

### Flow:
1. User wysyła bRUNE → LP (on-chain: `rebond` action, `newBondAddress = LP`)
2. LP odsyła userowi 0.95 × RUNE (on-chain: `send` action)
3. LP zatrzymuje 5% jako fee
4. LP trzyma bRUNE → zarabia bonding yield do momentu unbondu z node

### LP Effective APY = Bonding Yield + Fee Income
```
bondingYieldOnTotal = (bondedRUNE × networkBondingAPY) / totalCapital
feeYieldOnTotal     = (feeIncome30d × 365/30) / totalCapital
lpEffectiveAPY      = bondingYieldOnTotal + feeYieldOnTotal
```

### Fee income — MUSI być z realnych danych!
- ❌ WRONG: `feeIncome = bondingRewards × 0.05` (to liczy 5% od WŁASNYCH rewards LP)
- ❌ WRONG: `feeIncome = suma rebond actions × 5%` (dla obecnego flow Runebond to daje błędne lub zerowe wartości)
- ✅ CORRECT: Pobierz realne **outgoing `send` payouts** z LP w 30d, policz `gross = net / 0.95`, a potem `fee = gross - net`

### Proste wyjaśnienie biznesowe
1. LP zarabia bonding yield tylko na bonded części kapitału.
2. LP wypłaca userom `95%` wartości wyjścia w RUNE.
3. Pozostałe `5%` zostaje w LP jako fee.
4. Finalny APY LP to suma:
   - zysku z bondingu
   - zysku z fee na wyjściach użytkowników

---

## 🔧 THORChain API — kluczowe endpointy

| Endpoint | Co zwraca |
|----------|-----------|
| `midgard/v2/history/earnings?interval=day&count=30` | Bonding earnings per day → APY |
| `midgard/v2/network` | `bondingAPY`, `totalActiveBond` |
| `midgard/v2/bonds/{address}` | LP's bonded positions + nodes |
| `midgard/v2/actions?address={addr}` | Transaction history (send, rebond, unbond) |
| `thornode/cosmos/bank/v1beta1/balances/{addr}` | Liquid RUNE balance |
| CoinGecko | RUNE price (rate-limited!) |

### Action patterns które faktycznie mają znaczenie:
#### Outgoing payout (`send`) z LP do usera:
```json
{
  "type": "send",
  "in": [{ "address": "LP_ADDRESS", "coins": [{"amount": "3173000000", "asset": "THOR.RUNE"}] }],
  "out": [{ "address": "user_addr", "coins": [{"amount": "3173000000", "asset": "THOR.RUNE"}] }]
}
```

#### Historyczny `rebond`:
```json
{
  "type": "rebond",
  "in": [{ "address": "user_addr", "coins": [{"amount": "1866603125", "asset": "THOR.RUNE"}] }],
  "metadata": { "rebond": { "newBondAddress": "LP_ADDRESS", "nodeAddress": "..." } }
}
```

---

## ⚠️ Błędy do unikania

1. **Fee income NIE jest % od LP's own bonding rewards** — trzeba realny wolumen z Midgard actions
2. **Nie zakładaj, że redemption volume siedzi w `rebond`** — dla Runebond obecny flow jest widoczny głównie jako outgoing `send`
3. **`Network Bonding APY` bierz z `midgard/v2/network`** — nie polegaj tylko na rekonstrukcji z `history/earnings`
4. **Midgard actions paginacja** — CORS może blokować kolejne strony, dodaj try/catch
5. **Kwoty THORChain w 1e8** — zawsze dziel przez 1e8
6. **CoinGecko rate-limits** — obsłuż brak ceny gracefully
7. **BigInt na datach Midgard** — daty w nanosekundach, użyj BigInt do porównań
8. **`file://` origin** — niektóre endpointy mogą blokować, serwuj przez HTTP
9. **Pobieranie Paginowanych Danych Historycznych** — zawsze stosuj `localStorage` dla danych ciągłych jak historyczne transakcje, odczytuj z niego i doczytuj tylko najnowszą różnicę z API. Obcina to drastycznie zapotrzebowanie na powolne paginowanie całych historii i łagodzi zużycie zapytań (omijanie rate limist 429).
10. **Asynchroniczność Renderowania** — Wyciągaj małe żądania (szybki fetch) ze wspólnych wielkich paczek (Promise.all), żeby móc szybciej wyrenderować część UI użytkownikowi przed dokończeniem cięższego procesu. Używaj flag sterujących jak `isLoaded` do zachowania logiki dom-u dla brakujących jeszcze wartości w tle.
11. **Migracja API THORChain (2026-04)** — `midgard.ninerealms.com` i `thornode.ninerealms.com` robią teraz 301 redirect na `gateway.liquify.com`. Problem: odpowiedź 301 nie zawiera nagłówka `Access-Control-Allow-Origin`, więc przeglądarka blokuje redirect (CORS error). Fix: bezpośrednie URLe `gateway.liquify.com/chain/thorchain_midgard/v2/` i `gateway.liquify.com/chain/thorchain_api/`. Te zwracają `ACAO: *`.

---

## 🔮 Potencjalne next steps
- [ ] Historyczny wykres APY (chart.js)
- [x] Deploy na GitHub Pages (Zakończone)
- [ ] Alert kiedy APY spadnie poniżej progu
