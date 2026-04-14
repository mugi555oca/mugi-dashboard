let chartPriceNav, chartSpread, chartSupply, chartLPComposition;
let chartHistoryNav, chartHistoryPrices, chartHistoryFlows, chartHistoryMix;
let currentTab = 'sim';

const colors = {
    primary: '#203A61',
    copper1: '#C58C6D',
    copper2: '#E6B89C',
    blue: '#3B74B8',
    taupe: '#B5A8A0',
    gold: '#B8860B',
    purple: '#7F56D9',
    green: '#4CAF50',
    red: '#D9534F'
};

const historyState = {
    summary: [],
    prices: [],
    mix: []
};

function formatNumber(num) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function formatCurrency(num, decimals = 2) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals }).format(num || 0);
}

function formatMillions(num) {
    return `$${formatNumber((num || 0) / 1000000)}M`;
}

function initDashboard() {
    Chart.defaults.font.family = "'Montserrat', sans-serif";
    Chart.defaults.color = colors.taupe;

    const ids = ['days', 'vol', 'drift', 'eps', 'eps-tgt', 'reinvest', 'carry', 'vol-mult', 'stockup-premium', 'lp-fee'];
    ids.forEach(id => {
        const el = document.getElementById(`input-${id}`);
        if (el) {
            el.addEventListener('input', (e) => {
                document.getElementById(`val-${id}`).innerText = e.target.value;
                if (id === 'carry') {
                    const price = parseFloat(document.getElementById('input-price').value.replace(/,/g, '')) || 950;
                    const pa = (parseFloat(e.target.value) * 365 / price) * 100;
                    document.getElementById('val-carry-pa').innerText = pa.toFixed(2);
                }
            });
        }
    });

    document.getElementById('btn-run')?.addEventListener('click', runSim);
    document.getElementById('btn-new-seed')?.addEventListener('click', () => {
        document.getElementById('input-seed').value = Math.floor(Math.random() * 99999);
        runSim();
    });
    document.getElementById('input-enable-trading')?.addEventListener('change', (e) => {
        document.getElementById('trading-controls').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('input-enable-lp')?.addEventListener('change', (e) => {
        document.getElementById('lp-controls').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('input-enable-carry')?.addEventListener('change', (e) => {
        document.getElementById('carry-controls').classList.toggle('hidden', !e.target.checked);
    });
    document.getElementById('input-enable-stockup')?.addEventListener('change', (e) => {
        document.getElementById('stockup-controls').classList.toggle('hidden', !e.target.checked);
    });

    // Handle input formatting for manual entry fields
    const numericInputs = ['input-cmet', 'input-price', 'input-buy-usd', 'input-sell-usd', 'input-seed', 'input-stockup-frequency', 'input-stockup-grams'];
    numericInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // Change type to text to allow custom formatting
            el.type = 'text';
            
            // Initial format
            el.value = new Intl.NumberFormat('en-US').format(el.value);

            el.addEventListener('input', (e) => {
                // Remove non-digit characters except period
                let val = e.target.value.replace(/,/g, '');
                if (val === '' || isNaN(val)) return;
                
                // Keep cursor position logic could be complex, 
                // but for simple inputs we just reformat on blur or debounced
            });

            el.addEventListener('blur', (e) => {
                let val = parseFloat(e.target.value.replace(/,/g, ''));
                if (!isNaN(val)) {
                    e.target.value = new Intl.NumberFormat('en-US').format(val);
                }
            });

            el.addEventListener('focus', (e) => {
                // Remove commas for easier editing
                e.target.value = e.target.value.replace(/,/g, '');
            });
        }
    });

    const updateFlowEquivs = () => {
        const price = parseFloat((document.getElementById('input-price')?.value || '0').replace(/,/g, '')) || 1;
        const buyUsd = parseFloat((document.getElementById('input-buy-usd')?.value || '0').replace(/,/g, '')) || 0;
        const sellUsd = parseFloat((document.getElementById('input-sell-usd')?.value || '0').replace(/,/g, '')) || 0;
        document.getElementById('buy-cmet-equiv').innerText = `≈ ${formatNumber(buyUsd / price)} CMET`;
        document.getElementById('sell-cmet-equiv').innerText = `≈ ${formatNumber(sellUsd / price)} CMET`;
    };

    ['input-price', 'input-buy-usd', 'input-sell-usd'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateFlowEquivs);
        document.getElementById(id)?.addEventListener('blur', updateFlowEquivs);
    });

    updateFlowEquivs();
    runSim();
    loadHistoryData();
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tab}`));
    document.getElementById('sim-controls').classList.toggle('hidden', tab !== 'sim');
    document.getElementById('history-controls').classList.toggle('hidden', tab !== 'history');

    if (tab === 'sim') {
        document.getElementById('page-title').innerText = 'CMET - Critical Material Exposure Token';
        document.getElementById('page-subtitle').innerText = 'Interaktive Soft-Peg-/PAT-Mechanik';
    } else {
        document.getElementById('page-title').innerText = 'CMET Historical PAT Backtest';
        document.getElementById('page-subtitle').innerText = 'Historische Performance eines fixen CMR-Mix';
        if (historyState.summary.length) renderHistory();
    }
}

// Simple deterministic random generator (Lcg)
function seedRandom(seed) {
    return function() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

function runSim() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return parseFloat(el.value.replace(/,/g, '')) || 0;
    };

    const seed = parseInt(document.getElementById('input-seed').value) || 1234;
    const rng = seedRandom(seed);

    const days = parseInt(document.getElementById('input-days').value);
    const initialCMET = getVal('input-cmet');
    const initialPrice = getVal('input-price');
    const vol = parseFloat(document.getElementById('input-vol').value) / 100;
    const drift = parseFloat(document.getElementById('input-drift').value) / 100;
    const eps = parseFloat(document.getElementById('input-eps').value) / 100;
    const epsTgt = parseFloat(document.getElementById('input-eps-tgt').value) / 100;
    const tradingEnabled = document.getElementById('input-enable-trading')?.checked;
    const lpEnabled = document.getElementById('input-enable-lp')?.checked;
    const carryEnabled = document.getElementById('input-enable-carry')?.checked;
    const lpFeeRate = lpEnabled ? (parseFloat(document.getElementById('input-lp-fee').value) / 100) : 0;
    const avgBuyUSD = tradingEnabled ? getVal('input-buy-usd') : 0;
    const avgSellUSD = tradingEnabled ? getVal('input-sell-usd') : 0;
    const avgSellCMET = initialPrice > 0 ? avgSellUSD / initialPrice : 0;
    const volMult = tradingEnabled ? parseFloat(document.getElementById('input-vol-mult').value) : 0;
    const reinvestRate = parseFloat(document.getElementById('input-reinvest').value) / 100;
    const carryCostPerGram = carryEnabled ? parseFloat(document.getElementById('input-carry').value) : 0;
    const enableStockup = document.getElementById('input-enable-stockup').checked;
    const stockupFrequency = getVal('input-stockup-frequency');
    const stockupGrams = getVal('input-stockup-grams');
    const stockupPremium = parseFloat(document.getElementById('input-stockup-premium').value) / 100;

    let price = initialPrice;
    let poolCMET = initialCMET;
    let poolUSDT = initialCMET * initialPrice;
    let totalCMET = initialCMET;
    let reservePhysical = initialCMET;
    let reserveUSD = reservePhysical * initialPrice;
    let totalCarryCosts = 0;
    let capturedValue = 0;
    let netProfit = 0;
    const startInvestment = (initialCMET * initialPrice) * 2;
    let capturedPremium = 0;
    let capturedDiscount = 0;
    let stockupRevenue = 0;
    let lpFeesExternal = 0;
    let lpFeesInternal = 0;

    const data = { labels: [], spotPrice: [], nav: [], poolPrice: [], spread: [], spreadPost: [], supply: [], poolCMET: [], poolUSDT: [] };

    for (let t = 0; t <= days; t++) {
        if (t > 0) {
            // Use deterministic RNG for normality approximation
            let z = (rng() + rng() + rng() + rng() + rng() + rng() - 3) / 1.5;
            price = price * (1 + drift + vol * z);
            
            // Calculate Carry Costs (pure USD liability, NOT reducing material)
            let dailyCarry = reservePhysical * carryCostPerGram;
            totalCarryCosts += dailyCarry;
        }

        // External market flow: separated demand/supply with configurable bias and noise
        const buyNoise = Math.max(0, 1 + ((rng() - 0.5) * 2 * volMult));
        const sellNoise = Math.max(0, 1 + ((rng() - 0.5) * 2 * volMult));
        const extBuyUSD = avgBuyUSD * buyNoise;
        const extSellCMET = avgSellCMET * sellNoise;
        let k = poolCMET * poolUSDT;

        // First external sells into pool
        if (extSellCMET > 0) {
            const effectiveSellCMET = extSellCMET * (1 - lpFeeRate);
            const feeCmet = extSellCMET - effectiveSellCMET;
            const newPoolCMET = poolCMET + effectiveSellCMET + feeCmet;
            const newPoolUSDT = k / (poolCMET + effectiveSellCMET);
            const usdtOut = poolUSDT - newPoolUSDT;
            const feeUsd = usdtOut > 0 ? usdtOut * (lpFeeRate / Math.max(1e-9, (1 - lpFeeRate))) : 0;
            lpFeesExternal += feeUsd;
            poolCMET = newPoolCMET;
            poolUSDT = newPoolUSDT;
            k = (poolCMET - feeCmet) * poolUSDT;
        }

        // Then external buys from pool
        if (extBuyUSD > 0) {
            const effectiveBuyUSD = extBuyUSD * (1 - lpFeeRate);
            const feeUsd = extBuyUSD - effectiveBuyUSD;
            const newPoolUSDT = poolUSDT + effectiveBuyUSD + feeUsd;
            const newPoolCMET = k / (poolUSDT + effectiveBuyUSD);
            lpFeesExternal += feeUsd;
            poolCMET = newPoolCMET;
            poolUSDT = newPoolUSDT;
            k = poolCMET * (poolUSDT - feeUsd);
        }

        // Optional stock-up mechanism independent of secondary-market arbitrage
        if (enableStockup && stockupFrequency > 0 && t > 0 && t % stockupFrequency === 0) {
            const navBeforeStockup = totalCMET > 0 ? (reservePhysical * price / totalCMET) : price;
            const stockupValueUsd = stockupGrams * price;
            const issuePrice = navBeforeStockup * (1 + stockupPremium);
            const issuedCMET = issuePrice > 0 ? stockupValueUsd / issuePrice : 0;
            const navEquivalentTokens = navBeforeStockup > 0 ? stockupValueUsd / navBeforeStockup : 0;
            const stockupRevenueUsd = Math.max((navEquivalentTokens - issuedCMET) * navBeforeStockup, 0);
            stockupRevenue += stockupRevenueUsd;
            reservePhysical += stockupGrams;
            totalCMET += issuedCMET;
        }

        let poolPrice = poolUSDT / poolCMET;
        const preInterventionSpread = ((poolPrice / price) - 1) * 100;

        if (poolPrice > price * (1 + eps)) {
            // Premium: mint into pool until target band, then buy base backing + optional reinvest only from capture
            let targetPrice = price * (1 + epsTgt);
            let targetCMET = Math.sqrt(k / targetPrice);
            let dCMET = targetCMET - poolCMET;
            if (dCMET > 0) {
                let grossDUSDT = poolUSDT - (k / targetCMET);
                const feeUsd = grossDUSDT * lpFeeRate;
                let dUSDT = grossDUSDT - feeUsd;
                lpFeesInternal += feeUsd;
                poolCMET += dCMET;
                poolUSDT -= grossDUSDT;
                totalCMET += dCMET;

                const baseBackingUsd = dCMET * price;
                const grossCapture = dUSDT - baseBackingUsd;
                const reinvestUsd = Math.max(grossCapture, 0) * reinvestRate;
                const totalMaterialBuyUsd = baseBackingUsd + reinvestUsd;
                const boughtPhysical = totalMaterialBuyUsd / price;
                reservePhysical += boughtPhysical;

                capturedValue += grossCapture;
                netProfit += (grossCapture - reinvestUsd);
                capturedPremium += grossCapture;
            }
        } else if (poolPrice < price * (1 - eps)) {
            // Discount: sell material at spot, use proceeds to buy back discounted CMET until target band
            let targetPrice = price * (1 - epsTgt);
            let targetCMET = Math.sqrt(k / targetPrice);
            let dCMET = poolCMET - targetCMET;
            if (dCMET > 0) {
                let netDUSDT = (k / targetCMET) - poolUSDT;
                const grossDUSDT = netDUSDT / Math.max(1e-9, (1 - lpFeeRate));
                const feeUsd = grossDUSDT - netDUSDT;
                const materialToSell = grossDUSDT / price;
                if (reservePhysical >= materialToSell) {
                    reservePhysical -= materialToSell;
                    lpFeesInternal += feeUsd;
                    poolCMET -= dCMET;
                    poolUSDT += netDUSDT;
                    totalCMET -= dCMET;

                    const grossCapture = (dCMET * price) - grossDUSDT;
                    const reinvestUsd = Math.max(grossCapture, 0) * reinvestRate;
                    const boughtPhysical = reinvestUsd / price;
                    reservePhysical += boughtPhysical;

                    capturedValue += grossCapture;
                    netProfit += (grossCapture - reinvestUsd);
                    capturedDiscount += grossCapture;
                }
            }
        }

        poolPrice = poolUSDT / poolCMET;
        const postInterventionSpread = ((poolPrice / price) - 1) * 100;
        reserveUSD = reservePhysical * price;
        let nav = reserveUSD / totalCMET;

        data.labels.push(t);
        data.spotPrice.push(price);
        data.nav.push(nav);
        data.poolPrice.push(poolPrice);
        data.spread.push(preInterventionSpread);
        data.spreadPost.push(postInterventionSpread);
        data.supply.push(totalCMET);
        data.poolCMET.push(poolCMET);
        data.poolUSDT.push(poolUSDT);
    }

    updateSimDashboard(data, initialPrice, capturedValue, reserveUSD, initialCMET, capturedPremium, capturedDiscount, startInvestment, totalCarryCosts, reservePhysical, netProfit, enableStockup, stockupRevenue, days, carryEnabled, lpEnabled, lpFeesExternal, lpFeesInternal, poolCMET, poolUSDT, initialCMET, initialCMET * initialPrice);
    drawSimCharts(data, lpEnabled);
}

function updateSimDashboard(data, initialPrice, capturedValue, reserveUSD, initialCMET, capturedPremium, capturedDiscount, startInvestment, totalCarryCosts, finalPhysical, netProfit, enableStockup, stockupRevenue, days, carryEnabled, lpEnabled, lpFeesExternal, lpFeesInternal, finalPoolCMET, finalPoolUSDT, initialPoolCMET, initialPoolUSDT) {
    const finalNav = data.nav[data.nav.length - 1];
    const finalSupply = data.supply[data.supply.length - 1];
    const finalSpot = data.spotPrice[data.spotPrice.length - 1];
    const initialReserveUSD = initialCMET * initialPrice;

    // Help function for pct change coloring
    const setPct = (id, current, start) => {
        const el = document.getElementById(id);
        const pct = ((current / start) - 1) * 100;
        el.innerText = `${pct >= 0 ? '+' : ''}${formatNumber(pct)}%`;
        el.style.color = pct >= 0 ? colors.green : colors.red;
    };

    // Valyrium Spotpreis Kasten
    document.getElementById('kpi-spot').innerText = formatCurrency(finalSpot);
    document.getElementById('kpi-spot-start').innerText = `Start: ${formatCurrency(initialPrice)}`;
    setPct('kpi-spot-pct', finalSpot, initialPrice);

    document.getElementById('kpi-nav').innerText = formatCurrency(finalNav);
    document.getElementById('kpi-nav-start').innerText = `Start: ${formatCurrency(initialPrice)}`;
    setPct('kpi-nav-pct', finalNav, initialPrice);

    document.getElementById('kpi-res').innerText = `$${formatNumber(reserveUSD / 1000000)}M`;
    document.getElementById('kpi-res-start').innerText = `Start: $${formatNumber(initialReserveUSD / 1000000)}M`;
    setPct('kpi-res-pct', reserveUSD, initialReserveUSD);
    
    // Grams info in CMR card
    document.getElementById('kpi-res-grams').innerText = `${formatNumber(finalPhysical)} g`;
    document.getElementById('kpi-res-grams-start').innerText = `${formatNumber(initialCMET)} g`;
    setPct('kpi-res-grams-pct', finalPhysical, initialCMET);

    document.getElementById('kpi-supply').innerText = formatNumber(finalSupply);
    document.getElementById('kpi-supply-start').innerText = `Start: ${formatNumber(initialCMET)}`;
    setPct('kpi-supply-pct', finalSupply, initialCMET);

    // Carry Costs / Carry Capacity only when carry is enabled
    document.getElementById('kpi-carry-card').classList.toggle('hidden', !carryEnabled);
    document.getElementById('kpi-carry-capacity-card').classList.toggle('hidden', !carryEnabled);
    if (carryEnabled) {
        document.getElementById('kpi-carry').innerText = formatCurrency(totalCarryCosts, 0);

        const incomeBase = netProfit + (enableStockup ? stockupRevenue : 0);
        const carryCapacity = (days > 0 && finalPhysical > 0) ? (incomeBase / finalPhysical / days) : 0;
        document.getElementById('kpi-carry-capacity').innerText = `$${formatNumber(carryCapacity)}`;
        const carryCapacityPa = initialPrice > 0 ? (carryCapacity * 365 / initialPrice) * 100 : 0;
        document.getElementById('kpi-carry-capacity-sub').innerText = `≈ ${formatNumber(carryCapacityPa)}% p.a. affordable`;
    }

    // LP Fees / IL only when LP is enabled
    const lpFeesTotal = lpFeesExternal + lpFeesInternal;
    document.getElementById('kpi-fees-total-card').classList.toggle('hidden', !lpEnabled);
    document.getElementById('kpi-il-card').classList.toggle('hidden', !lpEnabled);
    document.getElementById('chart-lp-card').classList.toggle('hidden', !lpEnabled);
    let il = 0;
    let hodlValue = 0;
    let lpValue = 0;
    if (lpEnabled) {
        document.getElementById('kpi-fees-total').innerText = formatCurrency(lpFeesTotal, 0);
        document.getElementById('kpi-fees-total-sub').innerText = `Ext: ${formatCurrency(lpFeesExternal, 0)} | Int: ${formatCurrency(lpFeesInternal, 0)}`;
        hodlValue = initialPoolCMET * finalSpot + initialPoolUSDT;
        lpValue = finalPoolCMET * finalSpot + finalPoolUSDT;
        il = lpValue - hodlValue;
        document.getElementById('kpi-il').innerText = formatCurrency(il, 0);
        document.getElementById('kpi-il').style.color = il >= 0 ? colors.green : colors.red;
        document.getElementById('kpi-il-sub').innerText = `HODL: ${formatCurrency(hodlValue, 0)} | LP: ${formatCurrency(lpValue, 0)}`;
    }

    // Arbitrage Capture (Gross)
    document.getElementById('kpi-captured').innerText = formatCurrency(capturedValue, 0);
    document.getElementById('kpi-captured-sub').innerText = `Prem: ${formatCurrency(capturedPremium)} | Disc: ${formatCurrency(capturedDiscount)}`;
    
    // Arbitrage Profit (Net after Reinvest)
    document.getElementById('kpi-profit').innerText = formatCurrency(netProfit, 0);
    const profitRoi = startInvestment > 0 ? (netProfit / startInvestment) * 100 : 0;
    document.getElementById('kpi-profit-sub').innerText = `ROI: ${formatNumber(profitRoi)}% | Margin: ${formatNumber(capturedValue > 0 ? (netProfit/capturedValue)*100 : 0)}%`;

    // Stock-Up Revenue (only visible when enabled)
    const stockupCard = document.getElementById('kpi-stockup-card');
    stockupCard.classList.toggle('hidden', !enableStockup);
    if (enableStockup) {
        document.getElementById('kpi-stockup-revenue').innerText = formatCurrency(stockupRevenue, 0);
        document.getElementById('kpi-stockup-sub').innerText = `Premium issuance income`;
    }

    // Net Treasury Result (Profit - Carry Costs + Stock-Up Revenue)
    const treasuryResult = netProfit - (carryEnabled ? totalCarryCosts : 0) + (enableStockup ? stockupRevenue : 0) + (lpEnabled ? lpFeesTotal : 0);
    document.getElementById('kpi-treasury').innerText = formatCurrency(treasuryResult, 0);
    const treasuryRoi = startInvestment > 0 ? (treasuryResult / startInvestment) * 100 : 0;
    const treasuryParts = [`ROI: ${formatNumber(treasuryRoi)}%`, `Arb: +${formatCurrency(netProfit, 0)}`];
    if (enableStockup) treasuryParts.push(`Stock-Up: +${formatCurrency(stockupRevenue, 0)}`);
    if (lpEnabled) treasuryParts.push(`LP Fees: +${formatCurrency(lpFeesTotal, 0)}`);
    if (carryEnabled) treasuryParts.push(`Carry: -${formatCurrency(totalCarryCosts, 0)}`);
    document.getElementById('kpi-treasury-sub').innerText = treasuryParts.join(' | ');
    
    // Style the treasury card based on result
    const treasuryCard = document.getElementById('kpi-treasury').parentElement;
    if (treasuryResult < 0) {
        treasuryCard.style.background = 'rgba(217, 83, 79, 0.15)';
        treasuryCard.style.borderLeft = '4px solid #B03A36';
    } else {
        treasuryCard.style.background = 'rgba(76, 175, 80, 0.15)';
        treasuryCard.style.borderLeft = '4px solid #2D662F';
    }
}

function drawSimCharts(data, lpEnabled = false) {
    if (chartPriceNav) chartPriceNav.destroy();
    if (chartSpread) chartSpread.destroy();
    if (chartSupply) chartSupply.destroy();
    if (chartLPComposition) chartLPComposition.destroy();

    const eps = parseFloat(document.getElementById('input-eps').value) || 0;

    chartPriceNav = new Chart(document.getElementById('chartPriceNav').getContext('2d'), {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                { label: 'Valyrium Spot Price', data: data.spotPrice, borderColor: colors.purple, borderWidth: 2, pointRadius: 0, tension: 0.1 },
                { label: 'Net Asset Value (NAV)', data: data.nav, borderColor: colors.copper1, backgroundColor: 'rgba(197, 140, 109, 0.1)', borderWidth: 3, fill: true, pointRadius: 0, tension: 0.1 },
                { label: 'CMET Price', data: data.poolPrice, borderColor: colors.primary, borderWidth: 2, pointRadius: 0, tension: 0.1 }
            ]
        },
        options: baseLineOptions()
    });

    chartSpread = new Chart(document.getElementById('chartSpread').getContext('2d'), {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Pre-Intervention Spread (%)',
                    data: data.spread,
                    backgroundColor: data.spread.map(v => {
                        if (v >= eps) return '#8B5E3C';
                        if (v <= -eps) return '#1F4F82';
                        return v > 0 ? colors.copper2 : colors.blue;
                    }),
                    borderWidth: 0
                },
                {
                    label: 'Post-Intervention Spread (%)',
                    data: data.spreadPost,
                    type: 'line',
                    borderColor: colors.taupe,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Upper ε Trigger',
                    data: data.labels.map(() => eps),
                    type: 'line',
                    borderColor: '#8B5E3C',
                    borderDash: [6, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'Lower ε Trigger',
                    data: data.labels.map(() => -eps),
                    type: 'line',
                    borderColor: '#1F4F82',
                    borderDash: [6, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: baseBarOptions(true)
    });

    chartSupply = new Chart(document.getElementById('chartSupply').getContext('2d'), {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [{ label: 'Total CMET Supply', data: data.supply, borderColor: colors.primary, backgroundColor: 'rgba(32, 58, 97, 0.1)', borderWidth: 2, fill: true, pointRadius: 0, stepped: true }]
        },
        options: baseLineOptions(false)
    });

    if (lpEnabled) {
        chartLPComposition = new Chart(document.getElementById('chartLPComposition').getContext('2d'), {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    { label: 'Pool CMET', data: data.poolCMET, borderColor: colors.primary, backgroundColor: 'rgba(32, 58, 97, 0.08)', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                    { label: 'Pool USDT', data: data.poolUSDT, borderColor: colors.green, backgroundColor: 'rgba(76, 175, 80, 0.08)', borderWidth: 2, fill: false, pointRadius: 0, tension: 0.1, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' } },
                scales: {
                    y: { position: 'left', grid: { color: 'rgba(0,0,0,0.05)' } },
                    y1: { position: 'right', grid: { drawOnChartArea: false } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

async function loadHistoryData() {
    const [summary, prices, mix] = await Promise.all([
        fetch('data/summary.json').then(r => r.json()),
        fetch('data/prices.json').then(r => r.json()),
        fetch('data/mix.json').then(r => r.json())
    ]);

    historyState.summary = summary;
    historyState.prices = prices;
    historyState.mix = mix;

    if (currentTab === 'history') renderHistory();
}

function renderHistory() {
    const summary = historyState.summary;
    const prices = historyState.prices;
    const mix = [...historyState.mix].sort((a, b) => b.weight - a.weight);
    if (!summary.length || !prices.length || !mix.length) return;

    const start = summary[0];
    const end = summary[summary.length - 1];
    const totalFees = summary.reduce((sum, row) => sum + (row.feeValue || 0), 0);
    const totalMinted = summary.reduce((sum, row) => sum + (row.minted || 0), 0);
    const totalBurned = summary.reduce((sum, row) => sum + (row.burned || 0), 0);
    const netSupplyDelta = (end.supplyPost || 0) - (start.supplyPost || 0);

    document.getElementById('hist-nav').innerText = formatCurrency(end.navPre);
    document.getElementById('hist-nav-sub').innerText = `Start: ${formatCurrency(start.navPre)}`;
    document.getElementById('hist-reserve').innerText = formatMillions(end.reserveValuePre);
    document.getElementById('hist-reserve-sub').innerText = `Start: ${formatMillions(start.reserveValuePre)}`;
    document.getElementById('hist-supply').innerText = formatNumber(end.supplyPost);
    document.getElementById('hist-supply-sub').innerText = `Netto: ${netSupplyDelta >= 0 ? '+' : ''}${formatNumber(netSupplyDelta)}`;
    document.getElementById('hist-fees').innerText = formatCurrency(totalFees);
    document.getElementById('hist-fees-sub').innerText = `Minted: ${formatNumber(totalMinted)} | Burned: ${formatNumber(totalBurned)}`;
    document.getElementById('history-range').innerText = `${start.date.slice(0, 7)} bis ${end.date.slice(0, 7)}`;
    document.getElementById('history-start-value').innerText = formatMillions(start.reserveValuePre);

    renderMixList(mix);
    drawHistoryNav(summary);
    drawHistoryPrices(prices, mix.slice(0, 5).map(item => item.material));
    drawHistoryFlows(summary);
    drawHistoryMix(mix);
}

function drawHistoryNav(summary) {
    if (chartHistoryNav) chartHistoryNav.destroy();
    chartHistoryNav = new Chart(document.getElementById('chartHistoryNav').getContext('2d'), {
        type: 'line',
        data: {
            labels: summary.map(row => row.date),
            datasets: [
                { label: 'NAV', data: summary.map(row => row.navPre), borderColor: colors.copper1, backgroundColor: 'rgba(197, 140, 109, 0.12)', fill: false, borderWidth: 3, pointRadius: 0, tension: 0.2, yAxisID: 'y' },
                { label: 'Reserve Value', data: summary.map(row => row.reserveValuePre), borderColor: colors.primary, backgroundColor: 'rgba(32, 58, 97, 0.08)', fill: true, borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { position: 'left', grid: { color: 'rgba(0,0,0,0.05)' } },
                y1: { position: 'right', grid: { drawOnChartArea: false } },
                x: { grid: { display: false } }
            }
        }
    });
}

function drawHistoryPrices(prices, topMaterials) {
    if (chartHistoryPrices) chartHistoryPrices.destroy();
    const palette = [colors.primary, colors.copper1, colors.blue, '#7F56D9', '#16A34A'];
    chartHistoryPrices = new Chart(document.getElementById('chartHistoryPrices').getContext('2d'), {
        type: 'line',
        data: {
            labels: prices.map(row => row.date),
            datasets: topMaterials.map((material, idx) => ({
                label: material,
                data: prices.map(row => row[material]),
                borderColor: palette[idx],
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2
            }))
        },
        options: baseLineOptions()
    });
}

function drawHistoryFlows(summary) {
    if (chartHistoryFlows) chartHistoryFlows.destroy();
    chartHistoryFlows = new Chart(document.getElementById('chartHistoryFlows').getContext('2d'), {
        type: 'bar',
        data: {
            labels: summary.map(row => row.date),
            datasets: [
                { label: 'Minted', data: summary.map(row => row.minted), backgroundColor: colors.green, stack: 'flow' },
                { label: 'Burned', data: summary.map(row => row.burned), backgroundColor: colors.red, stack: 'flow' },
                { label: 'Fees (USD)', data: summary.map(row => row.feeValue), type: 'line', borderColor: colors.copper1, backgroundColor: colors.copper1, yAxisID: 'y1', pointRadius: 0, tension: 0.2 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { stacked: true, grid: { color: 'rgba(0,0,0,0.05)' } },
                y1: { position: 'right', grid: { drawOnChartArea: false } },
                x: { stacked: true, grid: { display: false } }
            }
        }
    });
}

function drawHistoryMix(mix) {
    if (chartHistoryMix) chartHistoryMix.destroy();
    chartHistoryMix = new Chart(document.getElementById('chartHistoryMix').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: mix.map(item => item.material),
            datasets: [{
                data: mix.map(item => item.weight * 100),
                backgroundColor: ['#203A61','#C58C6D','#3B74B8','#7F56D9','#16A34A','#E6B89C','#F59E0B','#10B981','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#64748B','#D946EF'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            cutout: '62%'
        }
    });
}

function renderMixList(mix) {
    const container = document.getElementById('mix-list');
    container.innerHTML = mix.map(item => `
        <div class="mix-item">
            <strong>${item.material}</strong>
            <div class="mix-weight">${formatNumber(item.weight * 100)}%</div>
            <div class="mix-use">${item.use}</div>
        </div>
    `).join('');
}

function baseLineOptions(showLegend = true) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: showLegend, position: 'top' } },
        scales: {
            y: { grid: { color: 'rgba(0,0,0,0.05)' } },
            x: { grid: { display: false } }
        }
    };
}

function baseBarOptions(showLegend = false) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: showLegend } },
        scales: {
            y: { grid: { color: 'rgba(0,0,0,0.05)' } },
            x: { grid: { display: false } }
        }
    };
}

window.initDashboard = initDashboard;
window.runSim = runSim;
