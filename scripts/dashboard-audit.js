const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HOST = '127.0.0.1';
const ROOT = process.cwd();
const pageArg = process.argv[2] || 'index.html';
const PAGE_PATH = `/${pageArg.replace(/^\/+/, '')}`;

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function createStaticServer(rootDir) {
  return http.createServer((req, res) => {
    const requestedPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
    const targetPath = path.join(rootDir, normalized);

    if (!targetPath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(targetPath, (error, data) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500);
        res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': getContentType(targetPath) });
      res.end(data);
    });
  });
}

function parsePercent(text) {
  const match = String(text || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseRune(text) {
  const match = String(text || '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function countVisibleRuneGlyphs(doc) {
  const runeGlyph = String.fromCharCode(0x16b1);
  const nodeFilter = doc.defaultView.NodeFilter;
  const walker = doc.createTreeWalker(doc.body, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.includes(runeGlyph)) return nodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,template')) return nodeFilter.FILTER_REJECT;
      return nodeFilter.FILTER_ACCEPT;
    }
  });
  let count = 0;
  const runeGlyphPattern = new RegExp(runeGlyph, 'g');
  while (walker.nextNode()) {
    count += (walker.currentNode.nodeValue.match(runeGlyphPattern) || []).length;
  }
  return count;
}

function countRawRuneGlyphsInSources() {
  const runeGlyph = String.fromCharCode(0x16b1);
  return ['index.html', 'index.v3.html', 'scripts/dashboard-audit.js'].reduce((count, file) => {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) return count;
    return count + (fs.readFileSync(fullPath, 'utf8').match(new RegExp(runeGlyph, 'g')) || []).length;
  }, 0);
}

function visibleTextFrom(element) {
  if (!element) return '';
  const doc = element.ownerDocument;
  const nodeFilter = doc.defaultView.NodeFilter;
  const walker = doc.createTreeWalker(element, nodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,template,.sr,[hidden],[aria-hidden="true"]')) {
        return nodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.trim() ? nodeFilter.FILTER_ACCEPT : nodeFilter.FILTER_REJECT;
    }
  });
  const parts = [];
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function approxEqual(a, b, tolerance = 0.03) {
  return a !== null && b !== null && Math.abs(a - b) <= tolerance;
}

function collectDomSnapshot(window) {
  const doc = window.document;
  const text = (id) => doc.getElementById(id)?.textContent?.trim() || '';
  const chart = doc.getElementById('hero-sparkline');

  return {
    lastUpdate: text('last-update'),
    investorsApy: text('investors-apy'),
    lpApy: text('lp-effective-apy'),
    runebondApy: text('runebond-apy'),
    splitGross: text('split-gross'),
    splitInvestor: text('split-investor'),
    splitBonding: text('split-bonding'),
    splitFees: text('split-fees'),
    networkApy: text('network-apy'),
    feeYield: text('fee-yield-pct'),
    heroChartYield: text('hero-chart-yield'),
    hero: {
      displayTrail: !!doc.querySelector('.hero .display-trail'),
      splitStrip: !!doc.querySelector('.hero-split-strip'),
      splitFull: text('hero-full-lp-apy'),
      splitInvestor: text('hero-investor-split-apy'),
      noteCount: doc.querySelectorAll('.spark-notes span').length,
      infoTipCount: doc.querySelectorAll('.apy-info-tip').length,
      monitorLogo: doc.querySelector('.spark-title-logo')?.getAttribute('src') || '',
      monitorTitleLabel: doc.querySelector('.spark-title')?.getAttribute('aria-label') || '',
      text: doc.querySelector('.hero')?.textContent?.replace(/\s+/g, ' ').trim() || ''
    },
    topbar: {
      buyRuneHref: doc.querySelector('.buy-rune-link')?.getAttribute('href') || '',
      buyRuneText: doc.querySelector('.buy-rune-link')?.textContent?.trim() || '',
      buyRuneTarget: doc.querySelector('.buy-rune-link')?.getAttribute('target') || '',
      buyRuneRel: doc.querySelector('.buy-rune-link')?.getAttribute('rel') || ''
    },
    favicon: {
      iconHrefs: Array.from(doc.querySelectorAll('link[rel~="icon"]')).map((link) => link.getAttribute('href') || ''),
      iconTypes: Array.from(doc.querySelectorAll('link[rel~="icon"]')).map((link) => link.getAttribute('type') || '')
    },
    statuses: {
      providers: text('providers-sync-status')
    },
    providerSummary: {
      deposited: text('provider-summary-deposited'),
      gross: text('provider-summary-gross'),
      investor: text('provider-summary-investor-yield'),
      value: text('provider-summary-value')
    },
    swapSummary: {
      count: text('swap-count'),
      gross: text('swap-summary-gross'),
      net: text('swap-summary-net'),
      fee: text('swap-summary-fee'),
      wallets: text('swap-summary-wallets')
    },
    nodeSummary: {
      bonded: text('node-summary-bonded'),
      activity: text('node-summary-activity'),
      activityNote: text('node-summary-activity-note'),
      largest: text('node-summary-largest'),
      withBond: text('node-summary-with-bond')
    },
    chart: {
      label: doc.querySelector('.spark-label')?.textContent?.trim() || '',
      points: Number(chart?.dataset?.points || 0),
      min: chart?.dataset?.min || '',
      max: chart?.dataset?.max || '',
      last: chart?.dataset?.last || '',
      unit: chart?.dataset?.unit || '',
      lineStroke: chart?.querySelector('.spark-line polyline')?.getAttribute('stroke') || ''
    },
    comparison: {
      exists: !!doc.querySelector('.comparison-panel'),
      title: doc.getElementById('comparison-title')?.textContent?.trim() || '',
      brandLogo: doc.querySelector('.comparison-brand-logo')?.getAttribute('src') || '',
      investor: text('comparison-investor-apy'),
      classic: text('comparison-classic-apy'),
      gross: text('comparison-gross-apy'),
      investorBar: text('comparison-investor-bar-value'),
      classicBar: text('comparison-classic-bar-value'),
      grossBar: text('comparison-gross-bar-value'),
      investorBarWidth: doc.getElementById('comparison-investor-bar')?.style?.getPropertyValue('--bar-width') || '',
      classicBarWidth: doc.getElementById('comparison-classic-bar')?.style?.getPropertyValue('--bar-width') || '',
      grossBarWidth: doc.getElementById('comparison-gross-bar')?.style?.getPropertyValue('--bar-width') || '',
      delta: text('comparison-delta'),
      deltaState: doc.getElementById('comparison-delta')?.getAttribute('data-state') || '',
      note: text('comparison-note'),
      rowCount: doc.querySelectorAll('.comparison-row[data-comparison-key]').length,
      activeKey: doc.querySelector('.comparison-row.is-active')?.getAttribute('data-comparison-key') || '',
      activePressedCount: doc.querySelectorAll('.comparison-row[aria-pressed="true"]').length,
      tabbableRows: doc.querySelectorAll('.comparison-row[data-comparison-key][tabindex="0"][role="button"]').length,
      text: visibleTextFrom(doc.querySelector('.comparison-panel'))
    },
    links: {
      firstSwap: doc.querySelector('#swaps-tbody a')?.getAttribute('href') || '',
      firstSwapTx: doc.querySelector('#swaps-tbody .tx-link-pill')?.getAttribute('href') || '',
      firstNode: doc.querySelector('#nodes-tbody a[href^="https://thorchain.net/node/"]')?.getAttribute('href') || '',
      firstNodeRunebond: doc.querySelector('#nodes-tbody a[href^="https://app.runebond.com/nodes/"]')?.getAttribute('href') || '',
      firstProvider: doc.querySelector('#providers-tbody a')?.getAttribute('href') || ''
    },
    apyBuildPanel: {
      exists: !!doc.querySelector('.apy-build-panel'),
      oldSimpleExplainer: !!doc.querySelector('.simple-explainer'),
      oldVitals: !!doc.querySelector('section.vitals'),
      oldHowcalc: !!doc.querySelector('section.howcalc'),
      headlineBadge: !!doc.querySelector('.apy-build-badge'),
      driverCard: !!doc.querySelector('.apy-drivers-card'),
      driverCards: doc.querySelectorAll('.apy-driver').length,
      hiddenDriverIds: [
        'network-apy',
        'network-apy-note',
        'bonding-yield-pct',
        'bonding-yield-rune',
        'fee-yield-pct',
        'fee-yield-rune',
        'redemption-volume',
        'redemption-count'
      ].filter((id) => doc.getElementById(id)?.classList.contains('sr')).length,
      flowSteps: doc.querySelectorAll('.apy-flow-step').length,
      flowConnectors: doc.querySelectorAll('.apy-flow-step[data-op]').length,
      investorStep: !!doc.querySelector('.apy-flow-step.is-investor'),
      text: visibleTextFrom(doc.querySelector('.apy-build-panel'))
    },
    runeUnit: {
      visibleGlyphs: countVisibleRuneGlyphs(doc),
      logoCount: doc.querySelectorAll('.rune-logo-unit img[src$="rune-logo-coingecko.png"]').length,
      sourceGlyphs: countRawRuneGlyphsInSources()
    },
    dataWorkbench: {
      hintText: doc.querySelector('.data-hint')?.textContent?.trim() || '',
      brandLogo: doc.querySelector('.data-workbench-brand-logo')?.getAttribute('src') || '',
      brandChip: doc.querySelector('.data-workbench-brand-chip')?.textContent?.trim() || '',
      updatedChipText: doc.getElementById('data-updated-chip')?.textContent?.trim() || '',
      panelTitles: Array.from(doc.querySelectorAll('.data-workbench .panel-title')).map(el => el.textContent.trim()),
      metaOnlyHeaders: doc.querySelectorAll('.data-workbench .panel-head.panel-head-meta-only').length,
      liveStatusInHead: !!doc.querySelector('.data-workbench-head #providers-sync-status'),
      providerCountText: doc.getElementById('providers-count')?.textContent?.trim() || '',
      nodeCountText: doc.getElementById('node-count')?.textContent?.trim() || '',
      swapCountText: doc.getElementById('swap-count')?.textContent?.trim() || '',
      nodeCountHidden: doc.getElementById('node-count')?.classList.contains('sr') || false,
      swapCountHidden: doc.getElementById('swap-count')?.classList.contains('sr') || false,
      bondRankHeader: doc.querySelector('table[data-table="bonds"] thead th')?.textContent?.trim() === '#',
      bondRankCells: doc.querySelectorAll('#nodes-tbody .row-num').length,
      bondColumnCount: doc.querySelectorAll('table[data-table="bonds"] thead th').length,
      nodeBrandLogoCount: doc.querySelectorAll('#nodes-tbody .node-brand-logo').length,
      firstRunebondLogo: doc.querySelector('#nodes-tbody .node-link-runebond img')?.getAttribute('src') || '',
      firstThorchainLogo: doc.querySelector('#nodes-tbody .node-link-thorchain img')?.getAttribute('src') || '',
      addressPills: doc.querySelectorAll('.data-workbench .address-pill').length,
      copyAddressButtons: doc.querySelectorAll('.data-workbench .copy-address-action').length,
      firstCopyValue: doc.querySelector('.data-workbench .copy-address-action')?.getAttribute('data-copy') || '',
      txLinkPills: doc.querySelectorAll('#swaps-tbody .tx-link-pill .external-link-icon').length
    },
    footer: {
      brandLogo: doc.querySelector('.footer-brand-logo')?.getAttribute('src') || '',
      brandHref: doc.querySelector('.footer-brand')?.getAttribute('href') || '',
      textMarkCount: doc.querySelectorAll('.footer-mark').length,
      statusCount: doc.querySelectorAll('.footer-status-group .panel-status').length,
      yieldStatus: text('yield-status'),
      sourceStatus: text('source-health-status'),
      lastUpdate: text('last-update')
    },
    countUp: {
      scriptPresent: Array.from(doc.scripts).some((script) =>
        /COUNT_UP_IDS/.test(script.textContent || '') &&
        /animateMetricText/.test(script.textContent || '') &&
        /prefers-reduced-motion/.test(script.textContent || '')
      )
    }
  };
}

function validateSnapshot(snapshot) {
  const checks = [];
  const sourceWarningCount = Number((snapshot.lastUpdate.match(/(\d+)\s+source warning/) || [])[1] || 0);
  const hasSourceWarnings = sourceWarningCount > 0;

  const investorsApy = parsePercent(snapshot.investorsApy);
  const lpApy = parsePercent(snapshot.lpApy);
  const runebondApy = parsePercent(snapshot.runebondApy);
  const heroChartYield = parsePercent(snapshot.heroChartYield);
  const splitGross = parsePercent(snapshot.splitGross);
  const splitInvestor = parsePercent(snapshot.splitInvestor);
  const networkApy = parsePercent(snapshot.networkApy);
  const comparisonInvestor = parsePercent(snapshot.comparison.investor);
  const comparisonClassic = parsePercent(snapshot.comparison.classic);
  const comparisonGross = parsePercent(snapshot.comparison.gross);
  const chartLast = parsePercent(snapshot.chart.last);
  const chartMin = parsePercent(snapshot.chart.min);
  const chartMax = parsePercent(snapshot.chart.max);

  checks.push({
    ok: !!snapshot.lastUpdate && !/Refreshing|Update failed/i.test(snapshot.lastUpdate),
    message: `dashboard completed refresh (${snapshot.lastUpdate || 'missing timestamp'})`
  });

  checks.push({
    ok: lpApy !== null && investorsApy !== null && runebondApy !== null,
    message: `core APY values present (${snapshot.lpApy} / ${snapshot.investorsApy} / ${snapshot.runebondApy})`
  });

  checks.push({
    ok: approxEqual(lpApy, splitGross),
    message: `gross split matches LP APY (${snapshot.lpApy} vs ${snapshot.splitGross})`
  });

  checks.push({
    ok: approxEqual(investorsApy, splitInvestor),
    message: `investor split matches Investors APY (${snapshot.investorsApy} vs ${snapshot.splitInvestor})`
  });

  checks.push({
    ok: approxEqual(investorsApy, heroChartYield),
    message: `yield monitor chart tile shows investor APY after split (${snapshot.heroChartYield})`
  });

  checks.push({
    ok: snapshot.hero.splitStrip &&
      approxEqual(lpApy, parsePercent(snapshot.hero.splitFull)) &&
      approxEqual(investorsApy, parsePercent(snapshot.hero.splitInvestor)) &&
      snapshot.hero.noteCount === 2,
    message: `hero explains Full LP -> Investor split (${snapshot.hero.splitFull} -> ${snapshot.hero.splitInvestor}) with compact yield chips`
  });

  checks.push({
    ok: snapshot.apyBuildPanel.exists &&
      !snapshot.apyBuildPanel.oldSimpleExplainer &&
      !snapshot.apyBuildPanel.oldVitals &&
      !snapshot.apyBuildPanel.oldHowcalc &&
      /Full LP yield comes from two sources/i.test(snapshot.apyBuildPanel.text) &&
      /APY logic/i.test(snapshot.apyBuildPanel.text) &&
      /Gross LP yield/i.test(snapshot.apyBuildPanel.text) &&
      /Bonding yield/i.test(snapshot.apyBuildPanel.text) &&
      /5% exit fees/i.test(snapshot.apyBuildPanel.text) &&
      /Investor APY/i.test(snapshot.apyBuildPanel.text) &&
      !snapshot.apyBuildPanel.headlineBadge &&
      !snapshot.apyBuildPanel.driverCard &&
      snapshot.apyBuildPanel.driverCards === 0 &&
      snapshot.apyBuildPanel.hiddenDriverIds === 8 &&
      snapshot.apyBuildPanel.flowSteps === 4 &&
      snapshot.apyBuildPanel.flowConnectors === 3 &&
      snapshot.apyBuildPanel.investorStep &&
      !/Live inputs|The values below|Updated from THORChain data|THORChain bond APY|LP bonding yield|Exit fee yield|bRUNE exits 30d/i.test(snapshot.apyBuildPanel.text),
    message: 'APY explanation is a premium bonding + fee -> gross LP -> investor APY flow without visible raw input cards'
  });

  checks.push({
    ok: approxEqual(investorsApy, lpApy / 2) && approxEqual(runebondApy, investorsApy),
    message: `50 / 50 split holds (${snapshot.lpApy} -> ${snapshot.investorsApy} / ${snapshot.runebondApy})`
  });

  checks.push({
    ok: snapshot.comparison.exists &&
      /LP vs Classic Bonding/i.test(snapshot.comparison.title) &&
      /runebond-logo-horizontal\.svg$/i.test(snapshot.comparison.brandLogo) &&
      approxEqual(comparisonInvestor, investorsApy) &&
      approxEqual(comparisonGross, lpApy) &&
      approxEqual(comparisonClassic, networkApy, 0.06) &&
      parseFloat(snapshot.comparison.investorBarWidth) > 0 &&
      parseFloat(snapshot.comparison.classicBarWidth) > 0 &&
      parseFloat(snapshot.comparison.grossBarWidth) > 0 &&
      snapshot.comparison.rowCount === 3 &&
      snapshot.comparison.tabbableRows === 3 &&
      snapshot.comparison.activeKey === 'investor' &&
      snapshot.comparison.activePressedCount === 1 &&
      /Investor APY:/i.test(snapshot.comparison.note) &&
      /after split/i.test(snapshot.comparison.note),
    message: `bottom comparison chart is interactive and matches investor APY, classic bonding baseline, and full LP context (${snapshot.comparison.investor} vs ${snapshot.comparison.classic})`
  });

  checks.push({
    ok: !snapshot.hero.displayTrail && !/Shown APY/i.test(snapshot.hero.text),
    message: 'hero APY area does not show the extra Shown APY caption'
  });

  checks.push({
    ok: snapshot.hero.infoTipCount === 0 &&
      /runebond-logo-horizontal\.svg$/i.test(snapshot.hero.monitorLogo) &&
      snapshot.hero.monitorTitleLabel === 'RUNEBOND Yield Monitor',
    message: 'hero has no extra info icon and RUNEBOND Yield Monitor wordmark is present'
  });

  checks.push({
    ok: snapshot.topbar.buyRuneHref === 'https://swap.runebond.com/' &&
      snapshot.topbar.buyRuneText === 'Buy RUNE' &&
      snapshot.topbar.buyRuneTarget === '_blank' &&
      /noopener/.test(snapshot.topbar.buyRuneRel),
    message: 'topbar includes a Buy RUNE link to RUNEBOND swap'
  });

  checks.push({
    ok: snapshot.favicon.iconHrefs.some((href) => /assets\/runebond-isologo\.svg(?:\?|$)/i.test(href)) &&
      snapshot.favicon.iconTypes.some((type) => type === 'image/svg+xml'),
    message: 'browser tab favicon uses the RUNEBOND isologo'
  });

  checks.push({
    ok: /runebond-logo-horizontal\.svg$/i.test(snapshot.footer.brandLogo) &&
      /^https:\/\/runebond\.com\/?$/i.test(snapshot.footer.brandHref) &&
      snapshot.footer.textMarkCount === 0 &&
      snapshot.footer.statusCount === 1 &&
      !!snapshot.footer.lastUpdate,
    message: 'footer uses RUNEBOND wordmark logo with one status chip and last-updated text'
  });

  checks.push({
    ok: snapshot.countUp.scriptPresent,
    message: 'entry metrics use a reduced-motion-safe count-up animation'
  });

  checks.push({
    ok: snapshot.runeUnit.visibleGlyphs === 0 &&
      snapshot.runeUnit.sourceGlyphs === 0 &&
      snapshot.runeUnit.logoCount >= 20,
    message: `RUNE amounts use logo units instead of raw glyphs (${snapshot.runeUnit.logoCount} logos)`
  });

  checks.push({
    ok: !snapshot.dataWorkbench.hintText &&
      /runebond-logo-horizontal\.svg$/i.test(snapshot.dataWorkbench.brandLogo) &&
      /LP data tables/i.test(snapshot.dataWorkbench.brandChip) &&
      snapshot.dataWorkbench.panelTitles.length === 0 &&
      snapshot.dataWorkbench.metaOnlyHeaders === 3 &&
      !snapshot.dataWorkbench.liveStatusInHead &&
      /^Updated\s|^Demo data$|^Update failed$/.test(snapshot.dataWorkbench.updatedChipText) &&
      snapshot.dataWorkbench.nodeCountHidden &&
      snapshot.dataWorkbench.swapCountHidden &&
      !/deposited capital/i.test(snapshot.dataWorkbench.providerCountText) &&
      !/nodes|with bond/i.test(snapshot.dataWorkbench.nodeCountText) &&
      !/exits|wallets/i.test(snapshot.dataWorkbench.swapCountText),
    message: 'data table area avoids duplicate hint, repeated headings, and visible count-summary pills'
  });

  checks.push({
    ok: !snapshot.dataWorkbench.bondRankHeader &&
      snapshot.dataWorkbench.bondRankCells === 0 &&
      snapshot.dataWorkbench.bondColumnCount === 3,
    message: 'LP bonded positions table has no rank numbering column'
  });

  checks.push({
    ok: hasSourceWarnings || (
      snapshot.dataWorkbench.nodeBrandLogoCount >= 2 &&
      /runebond-logo-horizontal\.svg$/i.test(snapshot.dataWorkbench.firstRunebondLogo) &&
      /thorchain-mark\.png$/i.test(snapshot.dataWorkbench.firstThorchainLogo)
    ),
    message: hasSourceWarnings
      ? `node brand-link logo check skipped because upstream sources warned (${snapshot.lastUpdate})`
      : 'LP bonded node rows show RUNEBOND and THORChain branded outbound links'
  });

  checks.push({
    ok: hasSourceWarnings || (
      /investor apy/i.test(snapshot.chart.label) &&
      /after split/i.test(snapshot.chart.label) &&
      snapshot.chart.points >= 2 &&
      snapshot.chart.unit === '%' &&
      chartMin !== null &&
      chartMax !== null &&
      chartLast !== null &&
      approxEqual(chartLast, investorsApy, 0.06) &&
      /^#?0b4cff$/i.test(snapshot.chart.lineStroke)
    ),
    message: hasSourceWarnings
      ? `yield chart skipped because upstream sources warned (${snapshot.lastUpdate})`
      : `yield chart matches investor APY (${snapshot.chart.points} pts, last ${snapshot.chart.last}% vs ${snapshot.investorsApy})`
  });

  checks.push({
    ok: parseRune(snapshot.providerSummary.deposited) !== null &&
      parseRune(snapshot.providerSummary.gross) !== null &&
      parseRune(snapshot.providerSummary.investor) !== null &&
      parseRune(snapshot.providerSummary.value) !== null,
    message: `provider summary populated (${snapshot.providerSummary.deposited}, ${snapshot.providerSummary.value})`
  });

  const swapSummaryLooksPopulated =
    parseRune(snapshot.swapSummary.gross) !== null &&
    parseRune(snapshot.swapSummary.net) !== null &&
    parseRune(snapshot.swapSummary.fee) !== null &&
    (parseRune(snapshot.swapSummary.wallets) !== null || /^\d+$/.test(snapshot.swapSummary.wallets));

  checks.push({
    ok: swapSummaryLooksPopulated || /Source warning/i.test(snapshot.swapSummary.count) || hasSourceWarnings,
    message: /Source warning/i.test(snapshot.swapSummary.count) || hasSourceWarnings
      ? `swap summary skipped because a source warned (${snapshot.swapSummary.count || snapshot.lastUpdate})`
      : `swap summary populated (${snapshot.swapSummary.gross}, ${snapshot.swapSummary.fee})`
  });

  checks.push({
    ok: hasSourceWarnings || (
      parseRune(snapshot.nodeSummary.bonded) !== null &&
      parsePercent(snapshot.nodeSummary.largest) !== null &&
      /^\d+\s+active$/i.test(snapshot.nodeSummary.activity) &&
      /\d+\s+standby/i.test(snapshot.nodeSummary.activityNote) &&
      /^\d+$/.test(snapshot.nodeSummary.withBond)
    ),
    message: hasSourceWarnings
      ? `node summary skipped because upstream sources warned (${snapshot.lastUpdate})`
      : `node summary populated (${snapshot.nodeSummary.bonded}, ${snapshot.nodeSummary.activity})`
  });

  checks.push({
    ok: /^https:\/\/thorchain\.net\/address\/thor1/i.test(snapshot.links.firstProvider) &&
      (hasSourceWarnings || /^https:\/\/thorchain\.net\/node\/thor1/i.test(snapshot.links.firstNode)) &&
      (hasSourceWarnings || /^https:\/\/app\.runebond\.com\/nodes\/thor1/i.test(snapshot.links.firstNodeRunebond)) &&
      (!snapshot.links.firstSwap || /^https:\/\/thorchain\.net\/address\/thor1/i.test(snapshot.links.firstSwap)) &&
      (!snapshot.links.firstSwapTx || /^https:\/\/runescan\.io\/tx\//i.test(snapshot.links.firstSwapTx)),
    message: hasSourceWarnings
      ? 'provider explorer link valid; other explorer link checks skipped because upstream sources warned'
      : 'table links point to THORChain node scanner and RUNEBOND node page'
  });

  checks.push({
    ok: snapshot.dataWorkbench.addressPills >= 3 &&
      snapshot.dataWorkbench.copyAddressButtons === snapshot.dataWorkbench.addressPills &&
      /^thor1/i.test(snapshot.dataWorkbench.firstCopyValue) &&
      (hasSourceWarnings || snapshot.dataWorkbench.txLinkPills > 0),
    message: hasSourceWarnings
      ? 'premium address rows keep copy controls; tx icon checks skipped because upstream sources warned'
      : 'premium address rows include copy buttons and Recent exits use external tx icon links'
  });

  return checks;
}

function validateTabs(window) {
  const doc = window.document;
  const views = [
    ['investors', 'Investor pool'],
    ['bonds', 'LP bonded positions'],
    ['exits', 'Recent exits']
  ];

  return views.map(([key, label]) => {
    const tab = doc.querySelector(`.tab-btn[data-tab="${key}"]`);
    const panel = doc.getElementById(`panel-${key}`);
    if (tab) tab.click();
    const summary = panel?.querySelector('.panel-summary');
    const nav = panel?.querySelector('.section-nav');
    const table = panel?.querySelector('.table-container');
    const navPlacedAboveColumns = !!summary && !!nav && !!table &&
      summary.nextElementSibling === nav &&
      nav.nextElementSibling === table;

    const otherPanelVisible = views
      .filter(([otherKey]) => otherKey !== key)
      .some(([otherKey]) => !doc.getElementById(`panel-${otherKey}`)?.hidden);

    return {
      ok: !!tab &&
        !!panel &&
        tab.textContent.includes(label) &&
        tab.getAttribute('aria-selected') === 'true' &&
        !panel.hidden &&
        !otherPanelVisible &&
        navPlacedAboveColumns,
      message: `data switcher opens ${label} with tabs directly above table columns`
    };
  });
}

function validateColumnFilters(window) {
  const doc = window.document;
  const checks = [];
  const filters = [
    {
      label: 'Investor address',
      tab: 'investors',
      inputIds: ['filter-investors', 'filter-investors-mobile'],
      tbodyId: 'providers-tbody'
    },
    {
      label: 'Node address',
      tab: 'bonds',
      inputIds: ['filter-bonds', 'filter-bonds-mobile'],
      tbodyId: 'nodes-tbody'
    },
    {
      label: 'Exit wallet',
      tab: 'exits',
      inputIds: ['filter-exits', 'filter-exits-mobile'],
      tbodyId: 'swaps-tbody'
    }
  ];

  filters.forEach(({ label, tab, inputIds, tbodyId }) => {
    const tabButton = doc.querySelector(`.tab-btn[data-tab="${tab}"]`);
    const inputs = inputIds.map(id => doc.getElementById(id)).filter(Boolean);
    const tbody = doc.getElementById(tbodyId);
    if (tabButton) tabButton.click();

    const realRows = tbody
      ? Array.from(tbody.querySelectorAll('tr')).filter(row =>
        !row.classList.contains('table-message') && !row.classList.contains('filter-empty'))
      : [];

    if (!inputs.length || !tbody || realRows.length === 0) {
      checks.push({
        ok: false,
        message: `${label} column filter could not be tested`
      });
      return;
    }

    const input = inputs[0];
    const shell = input.closest('.column-filter');
    const trigger = shell?.querySelector('.column-filter-trigger');
    const tools = shell?.closest('.th-inline-tools');
    const clearButtonsReady = inputs.every(candidate =>
      !!candidate.closest('.column-filter, .mobile-panel-filter')?.querySelector('.column-filter-clear, .mobile-filter-clear')
    );
    const searchSitsBeforeColumnLabel = !tools || tools.firstElementChild === shell;
    const startsCollapsed = shell && !shell.classList.contains('is-open') && !shell.classList.contains('has-value');
    if (trigger) trigger.click();
    const opensAfterClick = !shell || (!!trigger && shell.classList.contains('is-open') && trigger.getAttribute('aria-expanded') === 'true');

    input.value = 'zzzz-no-match-zzzz';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const emptyShown = !!tbody.querySelector('tr.filter-empty');
    const inputsSynced = inputs.every(candidate => candidate.value === input.value);
    const staysExpandedWithValue = !shell || shell.classList.contains('has-value');

    input.value = '';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    const cleared = !tbody.querySelector('tr.filter-empty') &&
      realRows.every(row => row.style.display !== 'none') &&
      inputs.every(candidate => candidate.value === '');

    checks.push({
      ok: searchSitsBeforeColumnLabel && clearButtonsReady && startsCollapsed && opensAfterClick && emptyShown && inputsSynced && staysExpandedWithValue && cleared,
      message: `${label} column filter has aligned search/clear controls, opens on search click, syncs desktop/mobile inputs, and clears rows`
    });
  });

  return checks;
}

function validateComparisonInteraction(window) {
  const doc = window.document;
  const rows = Array.from(doc.querySelectorAll('.comparison-row[data-comparison-key]'));
  const note = doc.getElementById('comparison-note');
  const checks = [];
  const targets = [
    ['classic', /live THORChain network APY/i],
    ['gross', /before split/i],
    ['investor', /Investor APY:/i]
  ];

  targets.forEach(([key, notePattern]) => {
    const row = rows.find(candidate => candidate.getAttribute('data-comparison-key') === key);
    if (row) row.click();
    const activeRows = rows.filter(candidate => candidate.classList.contains('is-active'));
    const pressedRows = rows.filter(candidate => candidate.getAttribute('aria-pressed') === 'true');
    checks.push({
      ok: !!row &&
        activeRows.length === 1 &&
        pressedRows.length === 1 &&
        activeRows[0] === row &&
        pressedRows[0] === row &&
        notePattern.test(note?.textContent || ''),
      message: `comparison row interaction selects ${key} and updates the explanation`
    });
  });

  const keyboardRow = rows.find(candidate => candidate.getAttribute('data-comparison-key') === 'classic');
  if (keyboardRow) {
    keyboardRow.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  checks.push({
    ok: !!keyboardRow &&
      keyboardRow.classList.contains('is-active') &&
      keyboardRow.getAttribute('aria-pressed') === 'true' &&
      /live THORChain network APY/i.test(note?.textContent || ''),
    message: 'comparison rows can be selected from the keyboard'
  });

  return checks;
}

async function waitForDashboard(window) {
  const start = Date.now();
  while (Date.now() - start < 90000) {
    const snapshot = collectDomSnapshot(window);
    const settled =
      /Last updated|source warning/.test(snapshot.lastUpdate) &&
      snapshot.providerSummary.deposited &&
      snapshot.providerSummary.deposited !== '—';

    if (settled) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return collectDomSnapshot(window);
}

async function run() {
  const server = createStaticServer(ROOT);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });

  try {
    const port = server.address().port;
    const pageUrl = `http://lvh.me:${port}${PAGE_PATH}`;
    const dom = await JSDOM.fromURL(pageUrl, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.fetch = fetch;
        window.AbortController = AbortController;
        window.console = console;
      }
    });

    const snapshot = await waitForDashboard(dom.window);
    const checks = [
      ...validateSnapshot(snapshot),
      ...validateTabs(dom.window),
      ...validateColumnFilters(dom.window),
      ...validateComparisonInteraction(dom.window)
    ];
    const failures = checks.filter((check) => !check.ok);

    console.log(JSON.stringify({
      snapshot,
      checks
    }, null, 2));

    dom.window.close();

    if (failures.length) {
      console.error(`\nDashboard audit failed with ${failures.length} issue(s).`);
      process.exitCode = 1;
      return;
    }

    console.log('\nDashboard audit passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
