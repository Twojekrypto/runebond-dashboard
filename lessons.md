# Runebond APY Dashboard — Lessons Learned

## ✅ Stan projektu (2025-03-25)

Dashboard **gotowy** (`index.html`). Wyświetla **real LP Effective APY** = bonding yield + fee income z prawdziwych danych 30d.

### Zweryfikowane wartości (live):
| Metric | Value | Źródło |
|--------|-------|--------|
| LP Effective APY | 18.44% | bonding + fee |
| Bonding Yield | 6.47% (na total capital) | Midgard earnings 30d |
| 5% Fee Income | 11.96% (174 ᚱ/30d) | Midgard rebond actions |
| 30d Redemption Volume | 3,484 ᚱ (37 claims) | Real rebond txns |
| Network Bonding APY | 22.73% | Midgard earnings |
| Total Capital | 17,712 ᚱ | bonded + liquid |

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
- ✅ CORRECT: Pobierz `rebond` actions z Midgard 30d → suma amounts × 5% = real fee income

---

## 🔧 THORChain API — kluczowe endpointy

| Endpoint | Co zwraca |
|----------|-----------|
| `midgard/v2/history/earnings?interval=day&count=30` | Bonding earnings per day → APY |
| `midgard/v2/network` | `totalActiveBond` |
| `midgard/v2/bonds/{address}` | LP's bonded positions + nodes |
| `midgard/v2/actions?address={addr}` | Transaction history (send, rebond, unbond) |
| `thornode/cosmos/bank/v1beta1/balances/{addr}` | Liquid RUNE balance |
| CoinGecko | RUNE price (rate-limited!) |

### Rebond action format:
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
2. **Midgard actions paginacja** — CORS może blokować kolejne strony, dodaj try/catch
3. **Kwoty THORChain w 1e8** — zawsze dziel przez 1e8
4. **CoinGecko rate-limits** — obsłuż brak ceny gracefully
5. **BigInt na datach Midgard** — daty w nanosekundach, użyj BigInt do porównań
6. **`file://` origin** — niektóre endpointy mogą blokować, serwuj przez HTTP
7. **Pobieranie Paginowanych Danych Historycznych** — zawsze stosuj `localStorage` dla danych ciągłych jak historyczne transakcje, odczytuj z niego i doczytuj tylko najnowszą różnicę z API. Obcina to drastycznie zapotrzebowanie na powolne paginowanie całych historii i łagodzi zużycie zapytań (omijanie rate limist 429).
8. **Asynchroniczność Renderowania** — Wyciągaj małe żądania (szybki fetch) ze wspólnych wielkich paczek (Promise.all), żeby móc szybciej wyrenderować część UI użytkownikowi przed dokończeniem cięższego procesu. Używaj flag sterujących jak `isLoaded` do zachowania logiki dom-u dla brakujących jeszcze wartości w tle.
9. **Migracja API THORChain (2026-04)** — `midgard.ninerealms.com` i `thornode.ninerealms.com` robią teraz 301 redirect na `gateway.liquify.com`. Problem: odpowiedź 301 nie zawiera nagłówka `Access-Control-Allow-Origin`, więc przeglądarka blokuje redirect (CORS error). Fix: bezpośrednie URLe `gateway.liquify.com/chain/thorchain_midgard/v2/` i `gateway.liquify.com/chain/thorchain_api/`. Te zwracają `ACAO: *`.

---

## 🔮 Potencjalne next steps
- [ ] Historyczny wykres APY (chart.js)
- [x] Deploy na GitHub Pages (Zakończone)
- [ ] Alert kiedy APY spadnie poniżej progu
